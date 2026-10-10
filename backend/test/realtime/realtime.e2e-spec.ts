import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import { Clock } from '../../src/clock/clock';
import { Mailer } from '../../src/mail/mailer';
import { WorkerModule } from '../../src/worker/worker.module';
import { WorkerService } from '../../src/worker/worker.service';
import {
  addCar,
  createTestApp,
  createUser,
  resetDomainData,
  spotByCode,
  TestApp,
  TestUser,
} from '../support/api';
import { connect as connectDb } from '../support/db';

const NOW = '2026-10-05T08:00:00Z';
const START = Date.parse('2026-10-05T08:30:00Z');
const MIN = 60_000;

interface Received {
  event: string;
  payload: Record<string, unknown>;
}

interface Client {
  socket: Socket;
  events: Received[];
  of(event: string): Record<string, unknown>[];
}

class NullMailer extends Mailer {
  send(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * ARCHITECTURE §4, §7 «Схема обновляется у всех без перезагрузки»: domain
 * transaction → pg_notify → COMMIT → LISTEN in the API → socket.io rooms.
 * Real PostgreSQL, real socket.io clients, worker as a separate Nest context.
 */
describe('realtime (socket.io over LISTEN/NOTIFY)', () => {
  let t: TestApp;
  let url: string;
  let worker: WorkerService;
  let closeWorker: () => Promise<void>;
  let operator: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  const clients: Client[] = [];

  beforeAll(async () => {
    t = await createTestApp(NOW);
    await t.app.listen(0, '127.0.0.1');
    const server = t.app.getHttpServer() as unknown as Server;
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;

    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    })
      .overrideProvider(Clock)
      .useValue(t.clock)
      .overrideProvider(Mailer)
      .useValue(new NullMailer())
      .compile();
    worker = moduleRef.get(WorkerService);
    closeWorker = () => moduleRef.close();
  });
  afterAll(async () => {
    await closeWorker?.();
    await t?.close();
  });
  beforeEach(async () => {
    t.clock.set(NOW);
    await resetDomainData(t.ds);
    operator = await createUser(t, { role: 'operator' });
    alice = await createUser(t);
    bob = await createUser(t);
  });
  afterEach(() => {
    for (const c of clients.splice(0)) c.socket.disconnect();
  });

  /** Resolves once the server has put the socket into its rooms. */
  function connect(token?: string): Promise<Client> {
    const socket = io(url, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    const client: Client = {
      socket,
      events: [],
      of: (event) =>
        client.events.filter((e) => e.event === event).map((e) => e.payload),
    };
    socket.onAny((event: string, payload: Record<string, unknown>) =>
      client.events.push({ event, payload }),
    );
    clients.push(client);
    return new Promise((resolve, reject) => {
      socket.on('session.ready', () => resolve(client));
      socket.on('connect_error', reject);
    });
  }

  async function eventually(check: () => void, ms = 3000): Promise<void> {
    const deadline = Date.now() + ms;
    for (;;) {
      try {
        check();
        return;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  }

  /** Long enough for a NOTIFY to travel if one had been sent. */
  const quiet = () => new Promise((r) => setTimeout(r, 400));

  const gate = (kind: 'entry' | 'exit', plate: string) =>
    t.http().post(`/api/gate/${kind}`).set(operator.auth).send({ plate });

  describe('handshake', () => {
    it('without a token → connect_error', async () => {
      await expect(connect()).rejects.toThrow(/UNAUTHORIZED/);
    });

    it('with a forged token → connect_error', async () => {
      await expect(connect(`${alice.token}x`)).rejects.toThrow(/UNAUTHORIZED/);
    });
  });

  it('a gate entry reaches every open map with the new state and version', async () => {
    const [a, b] = await Promise.all([
      connect(alice.token),
      connect(operator.token),
    ]);
    const res = await gate('entry', 'A123BC').expect(201);
    const expected = {
      spotId: res.body.spot.id,
      state: 'occupied',
      version: 1,
    };
    await eventually(() => {
      expect(a.of('spot.updated')).toEqual([expected]);
      expect(b.of('spot.updated')).toEqual([expected]);
    });

    const spots = await t.http().get('/api/spots').set(alice.auth).expect(200);
    expect(
      spots.body.find((s: { id: string }) => s.id === expected.spotId),
    ).toMatchObject({ state: 'occupied', version: 1 });
  });

  it('a no-show released by the worker process reaches the clients too', async () => {
    const car = await addCar(t, alice, 'A123BC');
    const spotId = await spotByCode(t, 'A01');
    const rows: { id: string }[] = await t.ds.query(
      `INSERT INTO bookings (user_id, car_id, spot_id, period)
       VALUES ($1, $2, $3, tstzrange($4, $5, '[)')) RETURNING id`,
      [alice.id, car.id, spotId, new Date(START), new Date(START + 60 * MIN)],
    );
    const [a, b] = await Promise.all([
      connect(alice.token),
      connect(bob.token),
    ]);

    t.clock.set(new Date(START - 10 * MIN));
    await worker.tick();
    t.clock.set(new Date(START + 15 * MIN));
    await worker.tick();

    const states = [
      { spotId, state: 'booked', version: 1 },
      { spotId, state: 'free', version: 2 },
    ];
    await eventually(() => {
      expect(a.of('spot.updated')).toEqual(states);
      expect(b.of('spot.updated')).toEqual(states);
      expect(a.of('booking.updated')).toEqual([
        { bookingId: rows[0].id, status: 'no_show' },
      ]);
    });
    await quiet();
    expect(b.of('booking.updated')).toEqual([]);
  });

  it('a rolled-back transaction sends nothing; a committed one does', async () => {
    const a = await connect(alice.token);
    const spotId = await spotByCode(t, 'A02');
    const db = await connectDb();
    try {
      // A car on the spot that the snapshot does not know about yet.
      await db.query(
        `INSERT INTO visits (plate, spot_id, entered_at) VALUES ('Z999ZZ', $1, $2)`,
        [spotId, NOW],
      );
      await db.query('BEGIN');
      await db.query(
        `SELECT * FROM refresh_spot_state($1, $2, make_interval(mins => 15))`,
        [spotId, NOW],
      );
      await db.query('ROLLBACK');
      await quiet();
      expect(a.events.filter((e) => e.event !== 'session.ready')).toEqual([]);

      await db.query(
        `SELECT * FROM refresh_spot_state($1, $2, make_interval(mins => 15))`,
        [spotId, NOW],
      );
      await eventually(() =>
        expect(a.of('spot.updated')).toEqual([
          { spotId, state: 'occupied', version: 1 },
        ]),
      );
    } finally {
      await db.end();
    }
  });

  it('booking.updated goes only to the owner', async () => {
    const car = await addCar(t, alice, 'A123BC');
    const booking = await t
      .http()
      .post('/api/bookings')
      .set(alice.auth)
      .send({
        carId: car.id,
        spotId: await spotByCode(t, 'A03'),
        from: '2026-10-05T12:00:00Z',
        to: '2026-10-05T13:00:00Z',
      })
      .expect(201);
    const [a, b, op] = await Promise.all([
      connect(alice.token),
      connect(bob.token),
      connect(operator.token),
    ]);

    await t
      .http()
      .post(`/api/bookings/${booking.body.id}/cancel`)
      .set(alice.auth)
      .expect(200);

    await eventually(() =>
      expect(a.of('booking.updated')).toEqual([
        { bookingId: booking.body.id, status: 'cancelled' },
      ]),
    );
    await quiet();
    expect(b.of('booking.updated')).toEqual([]);
    expect(op.of('booking.updated')).toEqual([]);
  });

  it('visit.updated: entry and exit (with the amount) to the owner and operators', async () => {
    await addCar(t, alice, 'A123BC');
    const [a, b, op] = await Promise.all([
      connect(alice.token),
      connect(bob.token),
      connect(operator.token),
    ]);

    const entered = await gate('entry', 'A123BC').expect(201);
    t.clock.set('2026-10-05T08:10:00Z');
    await gate('exit', 'A123BC').expect(200);

    const expected = [
      {
        visitId: entered.body.visitId,
        status: 'open',
        plate: 'A123BC',
        spotId: entered.body.spot.id,
      },
      {
        visitId: entered.body.visitId,
        status: 'closed',
        plate: 'A123BC',
        spotId: entered.body.spot.id,
        amountKop: 2500,
      },
    ];
    await eventually(() => {
      expect(a.of('visit.updated')).toEqual(expected);
      expect(op.of('visit.updated')).toEqual(expected);
    });
    await quiet();
    expect(b.of('visit.updated')).toEqual([]);
  });

  it('a guest visit is seen by operators only', async () => {
    const [a, op] = await Promise.all([
      connect(alice.token),
      connect(operator.token),
    ]);
    await gate('entry', 'G000ST').expect(201);
    await eventually(() => expect(op.of('visit.updated')).toHaveLength(1));
    await quiet();
    expect(a.of('visit.updated')).toEqual([]);
  });

  it('anomaly.created goes to operators only', async () => {
    const [a, op] = await Promise.all([
      connect(alice.token),
      connect(operator.token),
    ]);
    await gate('exit', 'A123BC').expect(409);
    await eventually(() =>
      expect(op.of('anomaly.created')).toEqual([
        { id: expect.any(String), kind: 'exit_without_entry', plate: 'A123BC' },
      ]),
    );
    await quiet();
    expect(a.of('anomaly.created')).toEqual([]);
  });

  it('after the LISTEN connection drops: sync.required, then events flow again', async () => {
    const a = await connect(alice.token);
    const killed: { n: number }[] = await t.ds.query(
      `SELECT count(pg_terminate_backend(pid))::int AS n
       FROM pg_stat_activity
       WHERE query = 'LISTEN parking_events' AND pid <> pg_backend_pid()`,
    );
    expect(killed[0].n).toBeGreaterThanOrEqual(1);

    await eventually(() => expect(a.of('sync.required')).toEqual([{}]), 5000);
    await gate('entry', 'A123BC').expect(201);
    await eventually(() => expect(a.of('spot.updated')).toHaveLength(1));
  });

  it('a refused request changes nothing on the map', async () => {
    const a = await connect(alice.token);
    await gate('exit', 'A123BC').expect(409);
    await gate('entry', '!!!').expect(422);
    await quiet();
    expect(a.of('spot.updated')).toEqual([]);
  });
});
