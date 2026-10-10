import {
  addCar,
  createTestApp,
  createUser,
  resetDomainData,
  TestApp,
  TestUser,
} from '../support/api';

const NOW = '2026-10-05T08:00:00Z';

/** ARCHITECTURE §7: «История визитов и счетов» + operator journals. */
describe('API: visit and invoice history', () => {
  let t: TestApp;
  let operator: TestUser;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    t = await createTestApp(NOW);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    t.clock.set(NOW);
    await resetDomainData(t.ds);
    operator = await createUser(t, { role: 'operator' });
    alice = await createUser(t);
    bob = await createUser(t);
    await addCar(t, alice, 'A123BC');
    await addCar(t, bob, 'B777OP');
  });

  const gate = (kind: 'entry' | 'exit', plate: string) =>
    t.http().post(`/api/gate/${kind}`).set(operator.auth).send({ plate });

  /** Alice: one closed visit (10 min) and one open; Bob and a guest: one each. */
  async function scenario() {
    await gate('entry', 'A123BC').expect(201);
    await gate('entry', 'B777OP').expect(201);
    await gate('entry', 'G000ST').expect(201);
    t.clock.set('2026-10-05T08:10:00Z');
    await gate('exit', 'A123BC').expect(200);
    await gate('exit', 'B777OP').expect(200);
    t.clock.set('2026-10-05T08:20:00Z');
    await gate('entry', 'A123BC').expect(201);
  }

  it('a driver sees only own visits, newest first, with the invoice', async () => {
    await scenario();
    const res = await t.http().get('/api/visits').set(alice.auth).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      plate: 'A123BC',
      enteredAt: '2026-10-05T08:20:00.000Z',
      exitedAt: null,
      invoice: null,
    });
    expect(res.body[1]).toMatchObject({
      plate: 'A123BC',
      enteredAt: '2026-10-05T08:00:00.000Z',
      exitedAt: '2026-10-05T08:10:00.000Z',
      closeReason: 'exit',
      invoice: { minutes: 10, amountKop: 2500 },
    });

    const one = await t
      .http()
      .get(`/api/visits/${res.body[1].id}`)
      .set(alice.auth)
      .expect(200);
    expect(one.body).toEqual(res.body[1]);
  });

  it('a driver sees only own invoices, with the tariff breakdown', async () => {
    await scenario();
    const res = await t.http().get('/api/invoices').set(alice.auth).expect(200);
    expect(res.body).toEqual([
      {
        id: expect.any(String),
        visitId: expect.any(String),
        plate: 'A123BC',
        minutes: 10,
        amountKop: 2500,
        segments: [
          {
            tariffId: expect.any(String),
            kind: 'day',
            from: '2026-10-05T08:00:00.000Z',
            to: '2026-10-05T08:10:00.000Z',
            minutes: 10,
            pricePerMinuteKop: 250,
            amountKop: 2500,
          },
        ],
        createdAt: '2026-10-05T08:10:00.000Z',
      },
    ]);
    await t
      .http()
      .get(`/api/invoices/${res.body[0].id}`)
      .set(alice.auth)
      .expect(200);
  });

  it("someone else's visit or invoice → 404", async () => {
    await scenario();
    const [bobVisit] = (
      await t.http().get('/api/visits').set(bob.auth).expect(200)
    ).body;
    const [bobInvoice] = (
      await t.http().get('/api/invoices').set(bob.auth).expect(200)
    ).body;

    for (const path of [
      `/api/visits/${bobVisit.id}`,
      `/api/invoices/${bobInvoice.id}`,
      '/api/visits/not-a-uuid',
      '/api/invoices/00000000-0000-0000-0000-000000000000',
    ]) {
      const res = await t.http().get(path).set(alice.auth).expect(404);
      expect(res.body.code).toMatch(/_NOT_FOUND$/);
    }
  });

  it('guest visits belong to nobody', async () => {
    await scenario();
    for (const u of [alice, bob]) {
      const res = await t.http().get('/api/visits').set(u.auth).expect(200);
      expect(res.body.map((v: { plate: string }) => v.plate)).not.toContain(
        'G000ST',
      );
    }
  });

  describe('operator', () => {
    it('sees all open visits, guests included', async () => {
      await scenario();
      const res = await t
        .http()
        .get('/api/operator/visits')
        .query({ status: 'open' })
        .set(operator.auth)
        .expect(200);
      expect(res.body.map((v: { plate: string }) => v.plate).sort()).toEqual([
        'A123BC',
        'G000ST',
      ]);
    });

    it('sees all visits without a filter', async () => {
      await scenario();
      const res = await t
        .http()
        .get('/api/operator/visits')
        .set(operator.auth)
        .expect(200);
      expect(res.body).toHaveLength(4);
    });

    it('sees the anomaly journal and the gate journal', async () => {
      await gate('exit', 'A123BC').expect(409);
      await gate('entry', '!!!').expect(422);

      const anomalies = await t
        .http()
        .get('/api/operator/anomalies')
        .set(operator.auth)
        .expect(200);
      expect(
        anomalies.body.map((a: { kind: string; plate: string | null }) => [
          a.kind,
          a.plate,
        ]),
      ).toEqual([
        ['invalid_plate', null],
        ['exit_without_entry', 'A123BC'],
      ]);

      const events = await t
        .http()
        .get('/api/operator/gate-events')
        .set(operator.auth)
        .expect(200);
      expect(
        events.body.map(
          (e: {
            kind: string;
            rawPlate: string;
            outcome: string;
            errorCode: string | null;
          }) => [e.kind, e.rawPlate, e.outcome, e.errorCode],
        ),
      ).toEqual([
        ['entry', '!!!', 'rejected', 'INVALID_PLATE'],
        ['exit', 'A123BC', 'rejected', 'NOT_INSIDE'],
      ]);
    });

    it('drivers cannot read operator journals', async () => {
      for (const path of [
        '/api/operator/visits',
        '/api/operator/anomalies',
        '/api/operator/gate-events',
      ]) {
        await t.http().get(path).set(alice.auth).expect(403);
      }
    });
  });
});
