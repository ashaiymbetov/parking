import { Test } from '@nestjs/testing';
import { Clock } from '../../src/clock/clock';
import { FakeClock } from '../../src/clock/fake-clock';
import { Mailer, SmtpMailer } from '../../src/mail/mailer';
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
import { Mailpit, startMailpit } from '../support/mailpit';

const START = Date.parse('2026-10-05T08:30:00Z'); // 14:30 in Bishkek
const END = Date.parse('2026-10-05T09:30:00Z'); // 15:30 in Bishkek
const MIN = 60_000;
const at = (ms: number) => new Date(ms);

class FailingMailer extends Mailer {
  calls = 0;
  send(): Promise<void> {
    this.calls += 1;
    return Promise.reject(new Error('SMTP is down'));
  }
}

async function createWorker(clock: FakeClock, mailer: Mailer) {
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(Mailer)
    .useValue(mailer)
    .compile();
  // No init(): the polling loop does not start, tests call tick() themselves.
  return {
    worker: moduleRef.get(WorkerService),
    close: () => moduleRef.close(),
  };
}

/**
 * ARCHITECTURE §5 and §7: no-show after 15 minutes, one reminder 10 minutes
 * before the end, both surviving downtime and concurrent workers. Real
 * PostgreSQL, real Mailpit, time from a FakeClock.
 */
describe('worker', () => {
  let t: TestApp;
  let mailpit: Mailpit;
  let smtp: SmtpMailer;
  let w: Awaited<ReturnType<typeof createWorker>>;
  let operator: TestUser;
  let driver: TestUser;

  beforeAll(async () => {
    t = await createTestApp('2026-10-05T08:00:00Z');
    mailpit = await startMailpit();
    smtp = new SmtpMailer({
      host: mailpit.smtpHost,
      port: mailpit.smtpPort,
      from: 'Parking <noreply@parking.local>',
    });
    w = await createWorker(t.clock, smtp);
  }, 120_000);
  afterAll(async () => {
    await w?.close();
    await t?.close();
    await mailpit?.stop();
  });
  beforeEach(async () => {
    t.clock.set('2026-10-05T08:00:00Z');
    await resetDomainData(t.ds);
    await mailpit.clear();
    operator = await createUser(t, { role: 'operator' });
    driver = await createUser(t);
  });

  async function booking(
    opts: { status?: string; from?: number; to?: number } = {},
  ): Promise<string> {
    const car = await addCar(t, driver, 'A123BC');
    const rows: { id: string }[] = await t.ds.query(
      `INSERT INTO bookings (user_id, car_id, spot_id, period, status)
       VALUES ($1, $2, $3, tstzrange($4, $5, '[)'), $6) RETURNING id`,
      [
        driver.id,
        car.id,
        await spotByCode(t, 'A01'),
        at(opts.from ?? START),
        at(opts.to ?? END),
        opts.status ?? 'confirmed',
      ],
    );
    return rows[0].id;
  }

  async function tickAt(ms: number, worker = w.worker) {
    t.clock.set(at(ms));
    await worker.tick();
  }

  async function bookingRow(id: string) {
    const rows: { status: string; released_at: Date | null }[] =
      await t.ds.query(
        `SELECT status, released_at FROM bookings WHERE id = $1`,
        [id],
      );
    return rows[0];
  }

  async function outbox() {
    return t.ds.query<
      {
        id: string;
        kind: string;
        status: string;
        attempts: number;
        next_attempt_at: Date;
        last_error: string | null;
      }[]
    >(
      `SELECT id, kind, status, attempts, next_attempt_at, last_error
       FROM email_outbox ORDER BY kind`,
    );
  }

  async function spotState(): Promise<string> {
    const rows: { state: string }[] = await t.ds.query(
      `SELECT state FROM spot_state WHERE spot_id = $1`,
      [await spotByCode(t, 'A01')],
    );
    return rows[0].state;
  }

  describe('no-show after 15 minutes (D-004, D-006)', () => {
    it('T+14:59 → still confirmed; T+15:00 → released, one email', async () => {
      const id = await booking();
      await tickAt(START + 15 * MIN - 1000);
      expect((await bookingRow(id)).status).toBe('confirmed');
      expect(await outbox()).toEqual([]);

      await tickAt(START + 15 * MIN);
      expect(await bookingRow(id)).toEqual({
        status: 'no_show',
        released_at: at(START + 15 * MIN),
      });
      expect(await outbox()).toMatchObject([
        { kind: 'no_show', status: 'sent' },
      ]);
      const mails = await mailpit.messages();
      expect(mails).toHaveLength(1);
      expect(mails[0].To.map((x) => x.Address)).toEqual([driver.email]);
      expect(mails[0].Subject).toMatch(/снята/i);
    });

    it('a car checked in at T+14 keeps its booking', async () => {
      const id = await booking();
      t.clock.set(at(START + 14 * MIN));
      await t
        .http()
        .post('/api/gate/entry')
        .set(operator.auth)
        .send({ plate: 'A123BC' })
        .expect(201);
      await tickAt(START + 20 * MIN);
      expect((await bookingRow(id)).status).toBe('checked_in');
      expect(await outbox()).toEqual([]);
    });

    it('the map shows booked in the last 15 minutes before, free after the release', async () => {
      await booking();
      await tickAt(START - 20 * MIN);
      expect(await spotState()).toBe('free');
      await tickAt(START - 10 * MIN);
      expect(await spotState()).toBe('booked');
      await tickAt(START + 15 * MIN);
      expect(await spotState()).toBe('free');
    });

    it('after 2 hours of downtime the first tick releases it and sends the email', async () => {
      const id = await booking();
      await tickAt(START + 120 * MIN);
      expect((await bookingRow(id)).status).toBe('no_show');
      // Released before the reminder task ran: no reminder for a no-show.
      expect((await outbox()).map((o) => [o.kind, o.status])).toEqual([
        ['no_show', 'sent'],
      ]);
      expect(await mailpit.messages()).toHaveLength(1);
    });

    it('two workers ticking at once → one release, one email', async () => {
      const id = await booking();
      const w2 = await createWorker(t.clock, smtp);
      try {
        t.clock.set(at(START + 15 * MIN));
        await Promise.all([w.worker.tick(), w2.worker.tick()]);
      } finally {
        await w2.close();
      }
      expect((await bookingRow(id)).status).toBe('no_show');
      expect(await outbox()).toHaveLength(1);
      expect(await mailpit.messages()).toHaveLength(1);
    });
  });

  describe('one reminder 10 minutes before the end (D-007)', () => {
    it('E−11 → nothing; E−10 → one email; E−5 → still one', async () => {
      await booking({ status: 'checked_in' });
      await tickAt(END - 11 * MIN);
      expect(await outbox()).toEqual([]);

      await tickAt(END - 10 * MIN);
      expect(await outbox()).toMatchObject([
        { kind: 'reminder', status: 'sent' },
      ]);

      await tickAt(END - 5 * MIN);
      expect(await outbox()).toHaveLength(1);
      const mails = await mailpit.messages();
      expect(mails).toHaveLength(1);
      expect(mails[0].To.map((x) => x.Address)).toEqual([driver.email]);
    });

    it('says when it ends in parking time, where, and for which car', async () => {
      await booking({ status: 'checked_in' });
      await tickAt(END - 10 * MIN);
      const [mail] = await mailpit.messages();
      const [row] = await outbox();
      expect(mail.Subject).toMatch(/10 минут/);
      expect(mail.MessageID).toBe(`outbox-${row.id}@parking.local`);
      const text = await mailpit.text(mail.ID);
      expect(text).toContain('15:30'); // 09:30Z in Asia/Bishkek
      expect(text).toContain('A01');
      expect(text).toContain('A123BC');
    });

    it('a driver who has not arrived yet is reminded too', async () => {
      // 15-minute booking: E−10 is still inside the 15-minute grace period.
      await booking({ from: START, to: START + 15 * MIN });
      await tickAt(START + 5 * MIN);
      expect((await outbox()).map((o) => o.kind)).toEqual(['reminder']);
    });

    it('two workers at E−10 → one row, one email', async () => {
      await booking({ status: 'checked_in' });
      const w2 = await createWorker(t.clock, smtp);
      try {
        t.clock.set(at(END - 10 * MIN));
        await Promise.all([w.worker.tick(), w2.worker.tick()]);
        await Promise.all([w.worker.tick(), w2.worker.tick()]);
      } finally {
        await w2.close();
      }
      expect(await outbox()).toHaveLength(1);
      expect(await mailpit.messages()).toHaveLength(1);
    });

    it.each(['cancelled', 'completed', 'no_show'])(
      'a %s booking gets no reminder',
      async (status) => {
        await booking({ status });
        await tickAt(END - 10 * MIN);
        expect(await outbox()).toEqual([]);
      },
    );

    it('downtime past the end → no email, skipped row and reminder_missed anomaly', async () => {
      const id = await booking({ status: 'checked_in' });
      await tickAt(END + 1 * MIN);
      expect(await outbox()).toMatchObject([
        { kind: 'reminder', status: 'skipped' },
      ]);
      const anomalies: { kind: string; booking_id: string }[] =
        await t.ds.query(`SELECT kind, booking_id FROM anomalies`);
      expect(anomalies).toEqual([{ kind: 'reminder_missed', booking_id: id }]);

      await tickAt(END + 5 * MIN);
      expect(await mailpit.messages()).toHaveLength(0);
      expect(await t.ds.query(`SELECT 1 FROM anomalies`)).toHaveLength(1);
    });
  });

  describe('sending (outbox)', () => {
    it('SMTP failures are retried with backoff, then the email is failed', async () => {
      await booking({ status: 'checked_in' });
      const failing = new FailingMailer();
      const wf = await createWorker(t.clock, failing);
      try {
        let now = END - 10 * MIN;
        await tickAt(now, wf.worker);
        let [row] = await outbox();
        expect(row).toMatchObject({
          status: 'pending',
          attempts: 1,
          last_error: 'SMTP is down',
        });
        expect(row.next_attempt_at).toEqual(at(now + 30_000));

        // Not due yet: no new attempt.
        await tickAt(now + 29_000, wf.worker);
        expect(failing.calls).toBe(1);

        for (const delay of [30_000, 60_000, 120_000, 240_000]) {
          now += delay;
          await tickAt(now, wf.worker);
        }
        [row] = await outbox();
        expect(failing.calls).toBe(5);
        expect(row).toMatchObject({ status: 'failed', attempts: 5 });

        await tickAt(now + 3_600_000, wf.worker);
        expect(failing.calls).toBe(5);
      } finally {
        await wf.close();
      }
    });

    it('a pending email is delivered by the next worker after a restart', async () => {
      await booking({ status: 'checked_in' });
      const wf = await createWorker(t.clock, new FailingMailer());
      try {
        await tickAt(END - 10 * MIN, wf.worker);
      } finally {
        await wf.close();
      }
      expect(await mailpit.messages()).toHaveLength(0);

      await tickAt(END - 9 * MIN);
      expect(await outbox()).toMatchObject([{ status: 'sent', attempts: 2 }]);
      expect(await mailpit.messages()).toHaveLength(1);
    });
  });
});
