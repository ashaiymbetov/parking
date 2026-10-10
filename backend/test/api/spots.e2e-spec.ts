import { Client, Notification } from 'pg';
import {
  addCar,
  createTestApp,
  createUser,
  resetDomainData,
  spotByCode,
  TestApp,
  TestUser,
} from '../support/api';
import { connect } from '../support/db';

const NOW = '2026-10-05T08:00:00Z';

interface SpotDto {
  id: string;
  code: string;
  row: number;
  col: number;
  state: string;
  version: number;
}

describe('API: spots with state and version (D-011)', () => {
  let t: TestApp;
  let driver: TestUser;
  let carId: string;
  let spotA01: string;

  beforeAll(async () => {
    t = await createTestApp(NOW);
    spotA01 = await spotByCode(t, 'A01');
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    t.clock.set(NOW);
    await resetDomainData(t.ds);
    driver = await createUser(t);
    carId = (await addCar(t, driver, 'A123BC')).id;
  });

  async function spots(user = driver): Promise<Map<string, SpotDto>> {
    const res = await t.http().get('/api/spots').set(user.auth).expect(200);
    return new Map((res.body as SpotDto[]).map((s) => [s.code, s]));
  }

  function book(spotId: string, from: string, to: string) {
    return t
      .http()
      .post('/api/bookings')
      .set(driver.auth)
      .send({ carId, spotId, from, to });
  }

  it('requires a login, open to drivers and operators', async () => {
    await t.http().get('/api/spots').expect(401);
    const operator = await createUser(t, { role: 'operator' });
    expect((await spots(operator)).size).toBe(20);
  });

  it('lists every spot with its state and a numeric version', async () => {
    const res = await t.http().get('/api/spots').set(driver.auth).expect(200);
    expect(res.body).toHaveLength(20);
    expect(res.body[0]).toEqual({
      id: spotA01,
      code: 'A01',
      row: 1,
      col: 1,
      state: 'free',
      version: 0,
    });
    expect((res.body as SpotDto[]).every((s) => s.state === 'free')).toBe(true);
  });

  it('free / booked / occupied by the one rule: occupied > booked > free', async () => {
    const [a02, a03, a04] = await Promise.all(
      ['A02', 'A03', 'A04'].map((c) => spotByCode(t, c)),
    );
    // A01: booking starts in 10 min → booked.
    await book(spotA01, '2026-10-05T08:10:00Z', '2026-10-05T09:00:00Z').expect(
      201,
    );
    // A02: booking starts in exactly 15 min → still free.
    const other = await createUser(t);
    const otherCar = await addCar(t, other, 'B777OP');
    await t
      .http()
      .post('/api/bookings')
      .set(other.auth)
      .send({
        carId: otherCar.id,
        spotId: a02,
        from: '2026-10-05T08:15:00Z',
        to: '2026-10-05T09:00:00Z',
      })
      .expect(201);
    // A03: a car is on it → occupied.
    await t.ds.query(
      `INSERT INTO visits (plate, spot_id, entered_at) VALUES ('Z999ZZ', $1, $2)`,
      [a03, '2026-10-05T07:00:00Z'],
    );
    // A04: a confirmed booking that started 5 min ago (inserted directly:
    // the API does not accept the past) → booked until no-show.
    const third = await createUser(t);
    const thirdCar = await addCar(t, third, 'E001KX');
    await t.ds.query(
      `INSERT INTO bookings (user_id, car_id, spot_id, period)
       VALUES ($1, $2, $3, tstzrange($4, $5, '[)'))`,
      [
        third.id,
        thirdCar.id,
        a04,
        '2026-10-05T07:55:00Z',
        '2026-10-05T09:00:00Z',
      ],
    );

    const s = await spots();
    expect(s.get('A01')!.state).toBe('booked');
    expect(s.get('A02')!.state).toBe('free');
    expect(s.get('A03')!.state).toBe('occupied');
    expect(s.get('A04')!.state).toBe('booked');
    expect(s.get('A05')!.state).toBe('free');
  });

  it('a started confirmed booking keeps the spot booked', async () => {
    await book(spotA01, '2026-10-05T08:00:00Z', '2026-10-05T09:00:00Z').expect(
      201,
    );
    t.clock.set('2026-10-05T08:10:00Z');
    expect((await spots()).get('A01')!.state).toBe('booked');
  });

  it('the state follows the clock without any write', async () => {
    await book(spotA01, '2026-10-05T08:30:00Z', '2026-10-05T09:00:00Z').expect(
      201,
    );
    expect((await spots()).get('A01')!.state).toBe('free');
    t.clock.set('2026-10-05T08:16:00Z');
    expect((await spots()).get('A01')!.state).toBe('booked');
    t.clock.set('2026-10-05T09:00:00Z');
    expect((await spots()).get('A01')!.state).toBe('free');
  });

  describe('booking mutations update the snapshot in the same transaction', () => {
    let listener: Client;
    let events: {
      type: string;
      spotId: string;
      state: string;
      version: number;
    }[];

    beforeEach(async () => {
      events = [];
      listener = await connect();
      listener.on('notification', (n: Notification) => {
        if (n.channel === 'parking_events' && n.payload) {
          events.push(JSON.parse(n.payload) as (typeof events)[number]);
        }
      });
      await listener.query('LISTEN parking_events');
    });
    afterEach(() => listener.end());

    /** NOTIFY arrives asynchronously after COMMIT. */
    async function waitForEvents(n: number): Promise<void> {
      for (let i = 0; i < 50 && events.length < n; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    it('a booking starting soon → booked, version + 1, one spot.updated event', async () => {
      const before = (await spots()).get('A01')!.version;
      await book(
        spotA01,
        '2026-10-05T08:10:00Z',
        '2026-10-05T09:00:00Z',
      ).expect(201);
      const after = (await spots()).get('A01')!;
      expect(after).toMatchObject({ state: 'booked', version: before + 1 });

      await waitForEvents(1);
      expect(events).toEqual([
        {
          type: 'spot.updated',
          spotId: spotA01,
          state: 'booked',
          version: before + 1,
        },
      ]);
    });

    it('cancelling it → free, version + 1 again', async () => {
      const before = (await spots()).get('A01')!.version;
      const res = await book(
        spotA01,
        '2026-10-05T08:10:00Z',
        '2026-10-05T09:00:00Z',
      ).expect(201);
      await t
        .http()
        .post(`/api/bookings/${res.body.id}/cancel`)
        .set(driver.auth)
        .expect(200);

      expect((await spots()).get('A01')).toMatchObject({
        state: 'free',
        version: before + 2,
      });
      await waitForEvents(2);
      expect(events.map((e) => [e.state, e.version])).toEqual([
        ['booked', before + 1],
        ['free', before + 2],
      ]);
    });

    it('a booking for later changes nothing and sends nothing', async () => {
      const before = (await spots()).get('A01')!.version;
      await book(
        spotA01,
        '2026-10-05T12:00:00Z',
        '2026-10-05T13:00:00Z',
      ).expect(201);
      expect((await spots()).get('A01')).toMatchObject({
        state: 'free',
        version: before,
      });
      await waitForEvents(1);
      expect(events).toEqual([]);
    });

    it('a rejected booking sends nothing', async () => {
      await book(
        spotA01,
        '2026-10-05T08:10:00Z',
        '2026-10-05T09:00:00Z',
      ).expect(201);
      await waitForEvents(1);
      events.length = 0;

      const other = await createUser(t);
      const otherCar = await addCar(t, other, 'B777OP');
      await t
        .http()
        .post('/api/bookings')
        .set(other.auth)
        .send({
          carId: otherCar.id,
          spotId: spotA01,
          from: '2026-10-05T08:05:00Z',
          to: '2026-10-05T08:30:00Z',
        })
        .expect(409);
      await waitForEvents(1);
      expect(events).toEqual([]);
    });
  });
});
