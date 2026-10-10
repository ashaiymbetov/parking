import {
  addCar,
  createTestApp,
  createUser,
  resetDomainData,
  spotByCode,
  TestApp,
  TestUser,
} from '../support/api';

const NOW = '2026-10-05T08:00:00Z'; // 14:00 in Bishkek

/**
 * Gate simulator (ARCHITECTURE §1.3, §1.5, §1.7; D-004, D-010, D-012).
 * Every request is journaled; garbage never changes visits or invoices.
 */
describe('API: gate simulator', () => {
  let t: TestApp;
  let operator: TestUser;

  beforeAll(async () => {
    t = await createTestApp(NOW);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    t.clock.set(NOW);
    await resetDomainData(t.ds);
    operator = await createUser(t, { role: 'operator' });
  });

  function gate(kind: 'entry' | 'exit', plate: unknown, key?: string) {
    const req = t.http().post(`/api/gate/${kind}`).set(operator.auth);
    if (key) req.set('Idempotency-Key', key);
    return req.send({ plate });
  }
  const entry = (plate: unknown, key?: string) => gate('entry', plate, key);
  const exit = (plate: unknown, key?: string) => gate('exit', plate, key);

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const rows: { n: number }[] = await t.ds.query(
      `SELECT count(*)::int AS n FROM ${sql}`,
      params,
    );
    return rows[0].n;
  }

  async function anomalies() {
    return t.ds.query<
      { kind: string; plate: string | null; booking_id: string | null }[]
    >(
      `SELECT kind, plate, booking_id FROM anomalies ORDER BY created_at, kind`,
    );
  }

  /** Puts a car on every active spot except the given codes. */
  async function fillAllBut(...codes: string[]) {
    await t.ds.query(
      `INSERT INTO visits (plate, spot_id, entered_at)
       SELECT 'FILL' || code, id, $2 FROM spots
       WHERE is_active AND NOT (code = ANY($1))`,
      [codes, '2026-10-05T07:00:00Z'],
    );
  }

  async function bookDirect(opts: {
    plate: string;
    spot: string;
    from: string;
    to: string;
  }) {
    const user = await createUser(t);
    const car = await addCar(t, user, opts.plate);
    const rows: { id: string }[] = await t.ds.query(
      `INSERT INTO bookings (user_id, car_id, spot_id, period)
       VALUES ($1, $2, $3, tstzrange($4, $5, '[)')) RETURNING id`,
      [user.id, car.id, await spotByCode(t, opts.spot), opts.from, opts.to],
    );
    return { user, car, bookingId: rows[0].id };
  }

  async function bookingStatus(id: string): Promise<string> {
    const rows: { status: string }[] = await t.ds.query(
      `SELECT status FROM bookings WHERE id = $1`,
      [id],
    );
    return rows[0].status;
  }

  describe('roles', () => {
    it('only an operator drives the gate', async () => {
      await t.http().post('/api/gate/entry').send({ plate: 'A1' }).expect(401);
      const driver = await createUser(t);
      await t
        .http()
        .post('/api/gate/entry')
        .set(driver.auth)
        .send({ plate: 'A1' })
        .expect(403);
      expect(await count('gate_events')).toBe(0);
    });
  });

  describe('entry without a booking (D-010)', () => {
    it('a guest gets a free spot; the visit has no owner', async () => {
      const res = await entry('A123BC').expect(201);
      expect(res.body).toEqual({
        visitId: expect.any(String),
        plate: 'A123BC',
        spot: { id: await spotByCode(t, 'A01'), code: 'A01' },
        bookingId: null,
        enteredAt: '2026-10-05T08:00:00.000Z',
      });
      const rows: { user_id: string | null; car_id: string | null }[] =
        await t.ds.query(`SELECT user_id, car_id FROM visits WHERE id = $1`, [
          res.body.visitId,
        ]);
      expect(rows).toEqual([{ user_id: null, car_id: null }]);
    });

    it('a registered car is matched by its normalized plate', async () => {
      const driver = await createUser(t);
      const car = await addCar(t, driver, 'A123BC');
      const res = await entry('а 123 вс').expect(201);
      expect(res.body.plate).toBe('A123BC');
      const rows: { user_id: string; car_id: string }[] = await t.ds.query(
        `SELECT user_id, car_id FROM visits WHERE id = $1`,
        [res.body.visitId],
      );
      expect(rows).toEqual([{ user_id: driver.id, car_id: car.id }]);
    });

    it('the spot becomes occupied on the map', async () => {
      const res = await entry('A123BC').expect(201);
      const spots = await t
        .http()
        .get('/api/spots')
        .set(operator.auth)
        .expect(200);
      expect(
        spots.body.find((s: { code: string }) => s.code === res.body.spot.code),
      ).toMatchObject({ state: 'occupied', version: 1 });
    });

    it('a spot whose booking starts within 15 minutes is not given away', async () => {
      await bookDirect({
        plate: 'B777OP',
        spot: 'A01',
        from: '2026-10-05T08:10:00Z',
        to: '2026-10-05T09:00:00Z',
      });
      const res = await entry('A123BC').expect(201);
      expect(res.body.spot.code).toBe('A02');
    });

    it('prefers spots with no bookings, then the latest next booking', async () => {
      await bookDirect({
        plate: 'B777OP',
        spot: 'A01',
        from: '2026-10-05T09:00:00Z',
        to: '2026-10-05T10:00:00Z',
      });
      await bookDirect({
        plate: 'E001KX',
        spot: 'A02',
        from: '2026-10-05T11:00:00Z',
        to: '2026-10-05T12:00:00Z',
      });
      expect((await entry('C100AA').expect(201)).body.spot.code).toBe('A03');

      await exit('C100AA').expect(200);
      await fillAllBut('A01', 'A02');
      expect((await entry('C200AA').expect(201)).body.spot.code).toBe('A02');
      expect((await entry('C300AA').expect(201)).body.spot.code).toBe('A01');
    });

    it('no free spot → 409 NO_FREE_SPOT, journaled, no visit', async () => {
      await fillAllBut();
      const before = await count('visits');
      const res = await entry('A123BC').expect(409);
      expect(res.body.code).toBe('NO_FREE_SPOT');
      expect(await count('visits')).toBe(before);
      expect(await anomalies()).toEqual([
        { kind: 'no_free_spot', plate: 'A123BC', booking_id: null },
      ]);
      expect(
        await count(
          `gate_events WHERE kind = 'entry' AND outcome = 'rejected' AND error_code = 'NO_FREE_SPOT'`,
        ),
      ).toBe(1);
    });

    it('two cars race for the last spot → one gets it, the other 409', async () => {
      await fillAllBut('B10');
      const responses = await Promise.all([entry('C100AA'), entry('C200AA')]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(responses.find((r) => r.status === 409)!.body.code).toBe(
        'NO_FREE_SPOT',
      );
      expect(
        await count(`visits WHERE exited_at IS NULL AND plate LIKE 'C%'`),
      ).toBe(1);
    });
  });

  describe('entry with a booking (D-004)', () => {
    const START = '2026-10-05T08:30:00Z';

    async function booked() {
      return bookDirect({
        plate: 'A123BC',
        spot: 'B05',
        from: START,
        to: '2026-10-05T09:30:00Z',
      });
    }

    it.each([
      ['15 min before the start', '2026-10-05T08:15:00Z'],
      ['at the start', '2026-10-05T08:30:00Z'],
      ['14:59 after the start', '2026-10-05T08:44:59Z'],
    ])('%s → checked in on the booked spot', async (_case, at) => {
      const { bookingId } = await booked();
      t.clock.set(at);
      const res = await entry('A123BC').expect(201);
      expect(res.body).toMatchObject({
        bookingId,
        spot: { code: 'B05' },
      });
      const rows: { status: string; checked_in_at: Date }[] = await t.ds.query(
        `SELECT status, checked_in_at FROM bookings WHERE id = $1`,
        [bookingId],
      );
      expect(rows[0].status).toBe('checked_in');
      expect(rows[0].checked_in_at.toISOString()).toBe(
        new Date(at).toISOString(),
      );
    });

    it.each([
      ['16 min before the start', '2026-10-05T08:14:00Z'],
      ['15 min after the start', '2026-10-05T08:45:00Z'],
    ])(
      '%s → an ordinary walk-in; the booking is untouched',
      async (_case, at) => {
        const { bookingId } = await booked();
        t.clock.set(at);
        const res = await entry('A123BC').expect(201);
        expect(res.body.bookingId).toBeNull();
        expect(await bookingStatus(bookingId)).toBe('confirmed');
      },
    );

    it('booked spot taken by an overstayer → another spot, still checked in, anomaly (Q6)', async () => {
      const { bookingId } = await booked();
      await t.ds.query(
        `INSERT INTO visits (plate, spot_id, entered_at) VALUES ('Z999ZZ', $1, $2)`,
        [await spotByCode(t, 'B05'), '2026-10-05T07:00:00Z'],
      );
      t.clock.set(START);
      const res = await entry('A123BC').expect(201);
      expect(res.body.bookingId).toBe(bookingId);
      expect(res.body.spot.code).not.toBe('B05');
      expect(await bookingStatus(bookingId)).toBe('checked_in');
      expect(await anomalies()).toEqual([
        {
          kind: 'booked_spot_occupied',
          plate: 'A123BC',
          booking_id: bookingId,
        },
      ]);
    });

    it('booked spot taken and nothing else free → 409, booking stays confirmed', async () => {
      const { bookingId } = await booked();
      await fillAllBut();
      t.clock.set(START);
      const res = await entry('A123BC').expect(409);
      expect(res.body.code).toBe('NO_FREE_SPOT');
      expect(await bookingStatus(bookingId)).toBe('confirmed');
      expect((await anomalies()).map((a) => a.kind)).toEqual(['no_free_spot']);
    });

    it('exit completes the booking', async () => {
      const { bookingId } = await booked();
      t.clock.set(START);
      await entry('A123BC').expect(201);
      t.clock.set('2026-10-05T09:00:00Z');
      await exit('A123BC').expect(200);
      expect(await bookingStatus(bookingId)).toBe('completed');
    });
  });

  describe('exit and the invoice (D-003, D-013)', () => {
    it('22:40 → 23:20 in Bishkek: 20 day minutes + 20 night minutes = 74.00', async () => {
      t.clock.set('2026-10-05T16:40:00Z');
      const { body: entered } = await entry('A123BC').expect(201);
      t.clock.set('2026-10-05T17:20:00Z');
      const res = await exit('A123BC').expect(200);

      expect(res.body.visit).toMatchObject({
        id: entered.visitId,
        plate: 'A123BC',
        spot: entered.spot,
        enteredAt: '2026-10-05T16:40:00.000Z',
        exitedAt: '2026-10-05T17:20:00.000Z',
        closeReason: 'exit',
      });
      expect(res.body.invoice).toMatchObject({
        id: expect.any(String),
        visitId: entered.visitId,
        minutes: 40,
        amountKop: 7400,
      });
      expect(
        res.body.invoice.segments.map(
          (s: { kind: string; minutes: number; amountKop: number }) => [
            s.kind,
            s.minutes,
            s.amountKop,
          ],
        ),
      ).toEqual([
        ['day', 20, 5000],
        ['night', 20, 2400],
      ]);
      const stored: { amount_kop: number; minutes: number }[] =
        await t.ds.query(
          `SELECT amount_kop, minutes FROM invoices WHERE visit_id = $1`,
          [entered.visitId],
        );
      expect(stored).toEqual([{ amount_kop: 7400, minutes: 40 }]);
    });

    it('30 seconds is one started minute', async () => {
      await entry('A123BC').expect(201);
      t.clock.set('2026-10-05T08:00:30Z');
      const res = await exit('A123BC').expect(200);
      expect(res.body.invoice).toMatchObject({ minutes: 1, amountKop: 250 });
    });

    it('the spot is free again', async () => {
      const { body } = await entry('A123BC').expect(201);
      t.clock.set('2026-10-05T08:10:00Z');
      await exit('A123BC').expect(200);
      const spots = await t
        .http()
        .get('/api/spots')
        .set(operator.auth)
        .expect(200);
      expect(
        spots.body.find((s: { id: string }) => s.id === body.spot.id),
      ).toMatchObject({ state: 'free', version: 2 });
    });
  });

  describe('garbage does not break the accounting (ARCHITECTURE §1.7)', () => {
    it('exit without entry → 409 NOT_INSIDE + anomaly; nothing else changes', async () => {
      const res = await exit('A123BC').expect(409);
      expect(res.body.code).toBe('NOT_INSIDE');
      expect(await count('visits')).toBe(0);
      expect(await count('invoices')).toBe(0);
      expect(await anomalies()).toEqual([
        { kind: 'exit_without_entry', plate: 'A123BC', booking_id: null },
      ]);
    });

    it('double entry → 409 ALREADY_INSIDE + anomaly; one open visit', async () => {
      await entry('A123BC').expect(201);
      const res = await entry('a 123 bc').expect(409);
      expect(res.body.code).toBe('ALREADY_INSIDE');
      expect(await count(`visits WHERE exited_at IS NULL`)).toBe(1);
      expect(await anomalies()).toEqual([
        { kind: 'double_entry', plate: 'A123BC', booking_id: null },
      ]);
    });

    it('double exit → the second is an exit without entry; one invoice', async () => {
      await entry('A123BC').expect(201);
      t.clock.set('2026-10-05T08:10:00Z');
      await exit('A123BC').expect(200);
      expect((await exit('A123BC').expect(409)).body.code).toBe('NOT_INSIDE');
      expect(await count('invoices')).toBe(1);
    });

    it.each([['!!!'], [''], ['Ж123ЖЖ'], ['A'.repeat(16)]])(
      'plate %j → 422 INVALID_PLATE, journaled with the raw value',
      async (raw) => {
        const res = await entry(raw).expect(422);
        expect(res.body.code).toBe('INVALID_PLATE');
        expect(await anomalies()).toEqual([
          { kind: 'invalid_plate', plate: null, booking_id: null },
        ]);
        const events: { raw_plate: string; plate: string | null }[] =
          await t.ds.query(`SELECT raw_plate, plate FROM gate_events`);
        expect(events).toEqual([{ raw_plate: raw, plate: null }]);
      },
    );

    it('a request without a plate is a validation error, not a gate event', async () => {
      const res = await entry(undefined).expect(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(await count('gate_events')).toBe(0);
    });

    it('10 parallel entries of one plate → one visit, nine ALREADY_INSIDE', async () => {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => entry('A123BC')),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([
        201,
        ...Array<number>(9).fill(409),
      ]);
      expect(
        responses
          .filter((r) => r.status === 409)
          .map((r) => (r.body as { code: string }).code),
      ).toEqual(Array<string>(9).fill('ALREADY_INSIDE'));
      expect(await count(`visits WHERE plate = 'A123BC'`)).toBe(1);
      expect(await count(`anomalies WHERE kind = 'double_entry'`)).toBe(9);
    });

    it('5 parallel exits of one plate → one invoice, four NOT_INSIDE', async () => {
      await entry('A123BC').expect(201);
      t.clock.set('2026-10-05T08:10:00Z');
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => exit('A123BC')),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([
        200, 409, 409, 409, 409,
      ]);
      expect(await count('invoices')).toBe(1);
    });
  });

  describe('Idempotency-Key (D-012)', () => {
    it('a repeated entry returns the stored response and does nothing again', async () => {
      const first = await entry('A123BC', 'sensor-1').expect(201);
      const again = await entry('A123BC', 'sensor-1').expect(201);
      expect(again.body).toEqual(first.body);
      expect(await count('visits')).toBe(1);
      expect(await count('gate_events')).toBe(1);
      expect(await count('anomalies')).toBe(0);
    });

    it('a repeated rejection is replayed, not journaled twice', async () => {
      const first = await exit('A123BC', 'sensor-2').expect(409);
      const again = await exit('A123BC', 'sensor-2').expect(409);
      expect(again.body).toEqual(first.body);
      expect(await count('anomalies')).toBe(1);
    });

    it('the same key sent 5 times at once → one visit, identical answers', async () => {
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => entry('A123BC', 'sensor-3')),
      );
      expect(new Set(responses.map((r) => r.status))).toEqual(new Set([201]));
      expect(new Set(responses.map((r) => JSON.stringify(r.body))).size).toBe(
        1,
      );
      expect(await count('visits')).toBe(1);
      expect(await count('gate_events')).toBe(1);
    });

    it('a different request with a used key → 422 IDEMPOTENCY_KEY_REUSED', async () => {
      await entry('A123BC', 'sensor-4').expect(201);
      const res = await exit('A123BC', 'sensor-4').expect(422);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await count('visits WHERE exited_at IS NULL')).toBe(1);
    });

    it('without a key a repeat is a real double entry', async () => {
      await entry('A123BC').expect(201);
      await entry('A123BC').expect(409);
      expect(await count('gate_events')).toBe(2);
    });
  });
});
