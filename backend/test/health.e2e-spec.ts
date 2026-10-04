import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Clock } from '../src/clock/clock';
import { FakeClock } from '../src/clock/fake-clock';
import { configureApp } from '../src/configure-app';

describe('GET /api/health (real PostgreSQL)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  const clock = new FakeClock('2026-10-04T07:00:00Z');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with db up and the time from the injected Clock', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(res.body).toEqual({
      status: 'ok',
      db: 'up',
      time: '2026-10-04T07:00:00.000Z',
    });
  });

  it('applied migrations on startup with synchronize disabled', async () => {
    expect(dataSource.options.synchronize).toBe(false);

    const applied: { name: string }[] = await dataSource.query(
      'SELECT name FROM migrations',
    );
    expect(applied.map((m) => m.name)).toContain(
      'EnableExtensions1791100486207',
    );

    const ext: { extname: string }[] = await dataSource.query(
      `SELECT extname FROM pg_extension WHERE extname IN ('btree_gist', 'citext')`,
    );
    expect(ext.map((e) => e.extname).sort()).toEqual(['btree_gist', 'citext']);
  });

  it('returns 503 when the database is unreachable', async () => {
    await dataSource.destroy();
    try {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .expect(503);
      expect(res.body).toMatchObject({ status: 'error', db: 'down' });
    } finally {
      await dataSource.initialize();
    }
  });
});
