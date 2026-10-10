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

describe('API: bookings', () => {
  let t: TestApp;
  let spotA01: string;
  let spotA02: string;

  beforeAll(async () => {
    t = await createTestApp(NOW);
    spotA01 = await spotByCode(t, 'A01');
    spotA02 = await spotByCode(t, 'A02');
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    t.clock.set(NOW);
    await resetDomainData(t.ds);
  });

  async function driverWithCar(plate?: string) {
    const user = await createUser(t);
    const car = await addCar(
      t,
      user,
      plate ?? `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    );
    return { user, car };
  }

  function book(
    user: TestUser,
    body: { carId: string; spotId: string; from: string; to: string },
  ) {
    return t.http().post('/api/bookings').set(user.auth).send(body);
  }

  it('creates a booking', async () => {
    const { user, car } = await driverWithCar('A123BC');
    const res = await book(user, {
      carId: car.id,
      spotId: spotA01,
      from: '2026-10-05T10:00:00Z',
      to: '2026-10-05T11:30:00Z',
    }).expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      status: 'confirmed',
      spot: { id: spotA01, code: 'A01' },
      car: { id: car.id, plate: 'A123BC' },
      from: '2026-10-05T10:00:00.000Z',
      to: '2026-10-05T11:30:00.000Z',
      createdAt: expect.any(String),
    });

    const mine = await t.http().get('/api/bookings').set(user.auth).expect(200);
    expect(mine.body.map((b: { id: string }) => b.id)).toEqual([res.body.id]);
  });

  it('accepts times in any offset and stores the same instant', async () => {
    const { user, car } = await driverWithCar();
    const res = await book(user, {
      carId: car.id,
      spotId: spotA01,
      from: '2026-10-05T16:00:00+06:00',
      to: '2026-10-05T17:00:00+06:00',
    }).expect(201);
    expect(res.body.from).toBe('2026-10-05T10:00:00.000Z');
  });

  describe('overlaps are rejected by the EXCLUDE constraint (D-002, D-024)', () => {
    it('20 parallel requests for one spot and overlapping intervals → exactly one 201, the rest 409', async () => {
      const drivers = [];
      for (let i = 0; i < 20; i++) drivers.push(await driverWithCar());

      const responses = await Promise.all(
        drivers.map(({ user, car }, i) =>
          book(user, {
            carId: car.id,
            spotId: spotA01,
            // All intervals overlap around 11:00–12:00.
            from: `2026-10-05T${String(9 + (i % 3)).padStart(2, '0')}:00:00Z`,
            to: `2026-10-05T${String(12 + (i % 2)).padStart(2, '0')}:00:00Z`,
          }),
        ),
      );

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([201, ...Array<number>(19).fill(409)]);
      for (const r of responses.filter((x) => x.status === 409)) {
        expect(r.body).toEqual({
          code: 'BOOKING_CONFLICT',
          message: expect.stringMatching(/занято|уже забронировано/i),
        });
      }
      const rows: { n: number }[] = await t.ds.query(
        `SELECT count(*)::int AS n FROM bookings WHERE spot_id = $1`,
        [spotA01],
      );
      expect(rows[0].n).toBe(1);
    });

    it('adjacent intervals (end of one = start of the next) do not conflict', async () => {
      const a = await driverWithCar();
      const b = await driverWithCar();
      await book(a.user, {
        carId: a.car.id,
        spotId: spotA01,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      }).expect(201);
      await book(b.user, {
        carId: b.car.id,
        spotId: spotA01,
        from: '2026-10-05T11:00:00Z',
        to: '2026-10-05T12:00:00Z',
      }).expect(201);
      await book(b.user, {
        carId: b.car.id,
        spotId: spotA01,
        from: '2026-10-05T09:00:00Z',
        to: '2026-10-05T10:00:00Z',
      }).expect(201);
    });

    it('an overlap by one minute is a conflict', async () => {
      const a = await driverWithCar();
      const b = await driverWithCar();
      await book(a.user, {
        carId: a.car.id,
        spotId: spotA01,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      }).expect(201);
      const res = await book(b.user, {
        carId: b.car.id,
        spotId: spotA01,
        from: '2026-10-05T10:59:00Z',
        to: '2026-10-05T12:00:00Z',
      }).expect(409);
      expect(res.body.code).toBe('BOOKING_CONFLICT');
    });

    it('one car cannot hold two spots at the same time', async () => {
      const { user, car } = await driverWithCar();
      await book(user, {
        carId: car.id,
        spotId: spotA01,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      }).expect(201);
      const res = await book(user, {
        carId: car.id,
        spotId: spotA02,
        from: '2026-10-05T10:30:00Z',
        to: '2026-10-05T11:30:00Z',
      }).expect(409);
      expect(res.body.code).toBe('CAR_ALREADY_BOOKED');
    });
  });

  describe('period validation (D-008) → 422 BOOKING_INVALID_PERIOD', () => {
    it.each([
      [
        'shorter than 15 minutes',
        '2026-10-05T10:00:00Z',
        '2026-10-05T10:14:00Z',
        'TOO_SHORT',
      ],
      [
        'longer than 24 hours',
        '2026-10-05T10:00:00Z',
        '2026-10-06T10:01:00Z',
        'TOO_LONG',
      ],
      [
        'in the past',
        '2026-10-05T07:59:00Z',
        '2026-10-05T09:00:00Z',
        'IN_THE_PAST',
      ],
      [
        'more than 7 days ahead',
        '2026-10-12T08:01:00Z',
        '2026-10-12T09:00:00Z',
        'TOO_FAR_AHEAD',
      ],
      [
        'seconds in bounds',
        '2026-10-05T10:00:30Z',
        '2026-10-05T11:00:00Z',
        'NOT_MINUTE_ALIGNED',
      ],
      [
        'end before start',
        '2026-10-05T11:00:00Z',
        '2026-10-05T10:00:00Z',
        'END_NOT_AFTER_START',
      ],
    ])('%s', async (_c, from, to, reason) => {
      const { user, car } = await driverWithCar();
      const res = await book(user, {
        carId: car.id,
        spotId: spotA01,
        from,
        to,
      }).expect(422);
      expect(res.body).toEqual({
        code: 'BOOKING_INVALID_PERIOD',
        message: expect.any(String),
        reason,
      });
    });

    it.each([
      ['no offset', '2026-10-05T10:00:00', '2026-10-05T11:00:00'],
      ['not a date', 'tomorrow', '2026-10-05T11:00:00Z'],
    ])(
      'times must be ISO 8601 with an offset (%s) → 422',
      async (_c, from, to) => {
        const { user, car } = await driverWithCar();
        const res = await book(user, {
          carId: car.id,
          spotId: spotA01,
          from,
          to,
        }).expect(422);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      },
    );

    it('booking "right now" (current minute) is allowed', async () => {
      t.clock.set('2026-10-05T08:00:40Z');
      const { user, car } = await driverWithCar();
      await book(user, {
        carId: car.id,
        spotId: spotA01,
        from: '2026-10-05T08:00:00Z',
        to: '2026-10-05T08:30:00Z',
      }).expect(201);
    });
  });

  describe('ownership and roles', () => {
    it("someone else's car → 404", async () => {
      const alice = await driverWithCar();
      const bob = await driverWithCar();
      const res = await book(bob.user, {
        carId: alice.car.id,
        spotId: spotA01,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      }).expect(404);
      expect(res.body.code).toBe('CAR_NOT_FOUND');
    });

    it('unknown spot → 404', async () => {
      const { user, car } = await driverWithCar();
      const res = await book(user, {
        carId: car.id,
        spotId: '00000000-0000-0000-0000-000000000000',
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      }).expect(404);
      expect(res.body.code).toBe('SPOT_NOT_FOUND');
    });

    it("someone else's booking is not visible → 404", async () => {
      const alice = await driverWithCar();
      const bob = await driverWithCar();
      const created = await book(alice.user, {
        carId: alice.car.id,
        spotId: spotA01,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      }).expect(201);
      await t
        .http()
        .get(`/api/bookings/${created.body.id}`)
        .set(bob.user.auth)
        .expect(404);
      await t
        .http()
        .post(`/api/bookings/${created.body.id}/cancel`)
        .set(bob.user.auth)
        .expect(404);
    });

    it('an operator cannot book → 403', async () => {
      const operator = await createUser(t, { role: 'operator' });
      const res = await t
        .http()
        .post('/api/bookings')
        .set(operator.auth)
        .send({
          carId: '00000000-0000-0000-0000-000000000000',
          spotId: spotA01,
          from: '2026-10-05T10:00:00Z',
          to: '2026-10-05T11:00:00Z',
        })
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('cancellation (D-026: only before the start)', () => {
    async function booked() {
      const d = await driverWithCar();
      const res = await book(d.user, {
        carId: d.car.id,
        spotId: spotA01,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      }).expect(201);
      return { ...d, bookingId: res.body.id as string };
    }

    it('cancelling before the start frees the slot for others', async () => {
      const { user, bookingId } = await booked();
      const res = await t
        .http()
        .post(`/api/bookings/${bookingId}/cancel`)
        .set(user.auth)
        .expect(200);
      expect(res.body.status).toBe('cancelled');

      const other = await driverWithCar();
      await book(other.user, {
        carId: other.car.id,
        spotId: spotA01,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      }).expect(201);
    });

    it('cannot cancel once the booking has started', async () => {
      const { user, bookingId } = await booked();
      t.clock.set('2026-10-05T10:00:00Z');
      const res = await t
        .http()
        .post(`/api/bookings/${bookingId}/cancel`)
        .set(user.auth)
        .expect(409);
      expect(res.body.code).toBe('BOOKING_NOT_CANCELLABLE');
    });

    it('cannot cancel twice', async () => {
      const { user, bookingId } = await booked();
      await t
        .http()
        .post(`/api/bookings/${bookingId}/cancel`)
        .set(user.auth)
        .expect(200);
      const res = await t
        .http()
        .post(`/api/bookings/${bookingId}/cancel`)
        .set(user.auth)
        .expect(409);
      expect(res.body.code).toBe('BOOKING_NOT_CANCELLABLE');
    });
  });

  describe('a spot with a car on it right now (D-008)', () => {
    async function occupy(spotId: string) {
      await t.ds.query(
        `INSERT INTO visits (plate, spot_id, entered_at) VALUES ('Z999ZZ', $1, $2)`,
        [spotId, '2026-10-05T07:00:00Z'],
      );
    }

    it('cannot be booked to start within 15 minutes → 409 SPOT_OCCUPIED', async () => {
      await occupy(spotA01);
      const { user, car } = await driverWithCar();
      const res = await book(user, {
        carId: car.id,
        spotId: spotA01,
        from: '2026-10-05T08:10:00Z',
        to: '2026-10-05T09:00:00Z',
      }).expect(409);
      expect(res.body.code).toBe('SPOT_OCCUPIED');
    });

    it('can be booked for later', async () => {
      await occupy(spotA01);
      const { user, car } = await driverWithCar();
      await book(user, {
        carId: car.id,
        spotId: spotA01,
        from: '2026-10-05T08:15:00Z',
        to: '2026-10-05T09:00:00Z',
      }).expect(201);
    });
  });

  describe('spots', () => {
    it('lists the 20 spots of the parking', async () => {
      const { user } = await driverWithCar();
      const res = await t.http().get('/api/spots').set(user.auth).expect(200);
      expect(res.body).toHaveLength(20);
      expect(res.body[0]).toEqual({ id: spotA01, code: 'A01', row: 1, col: 1 });
    });

    it('availability excludes spots booked for an overlapping interval', async () => {
      const { user, car } = await driverWithCar();
      await book(user, {
        carId: car.id,
        spotId: spotA01,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      }).expect(201);

      const overlapping = await t
        .http()
        .get('/api/spots/availability')
        .query({ from: '2026-10-05T10:30:00Z', to: '2026-10-05T11:30:00Z' })
        .set(user.auth)
        .expect(200);
      const codes = overlapping.body.map((s: { code: string }) => s.code);
      expect(codes).toHaveLength(19);
      expect(codes).not.toContain('A01');

      const adjacent = await t
        .http()
        .get('/api/spots/availability')
        .query({ from: '2026-10-05T11:00:00Z', to: '2026-10-05T12:00:00Z' })
        .set(user.auth)
        .expect(200);
      expect(adjacent.body).toHaveLength(20);
    });
  });
});
