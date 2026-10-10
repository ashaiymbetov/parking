import { createTestApp, resetDomainData, TestApp } from '../support/api';

describe('API: auth (D-005)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp('2026-10-05T08:00:00Z');
  });
  afterAll(() => t.close());
  beforeEach(() => resetDomainData(t.ds));

  const register = (email: string, password = 'secret-pass') =>
    t.http().post('/api/auth/register').send({ email, password });

  it('registers a driver and returns a working token', async () => {
    const res = await register('Driver@Example.com').expect(201);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      user: {
        id: expect.any(String),
        email: 'driver@example.com',
        role: 'driver',
      },
    });

    const me = await t
      .http()
      .get('/api/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body).toEqual({
      id: res.body.user.id,
      email: 'driver@example.com',
      role: 'driver',
      cars: [],
    });
  });

  it('rejects a second registration with the same email in another case', async () => {
    await register('driver@example.com').expect(201);
    const res = await register('DRIVER@example.com').expect(409);
    expect(res.body).toEqual({
      code: 'EMAIL_TAKEN',
      message: expect.any(String),
    });
  });

  it.each([
    ['invalid email', { email: 'not-an-email', password: 'secret-pass' }],
    ['short password', { email: 'a@b.cd', password: 'short' }],
    [
      'unknown field',
      { email: 'a@b.cd', password: 'secret-pass', role: 'operator' },
    ],
  ])('validates registration input (%s) → 422', async (_c, body) => {
    const res = await t
      .http()
      .post('/api/auth/register')
      .send(body)
      .expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('logs in with the right password, case-insensitive email', async () => {
    await register('driver@example.com').expect(201);
    const res = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'DRIVER@example.com', password: 'secret-pass' })
      .expect(200);
    expect(res.body.user).toMatchObject({
      email: 'driver@example.com',
      role: 'driver',
    });
  });

  it('wrong password and unknown email look the same', async () => {
    await register('driver@example.com').expect(201);
    const wrong = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'driver@example.com', password: 'wrong-pass' })
      .expect(401);
    const unknown = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'secret-pass' })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
  });

  it.each([
    ['no token', undefined],
    ['garbage token', 'Bearer not-a-jwt'],
    ['wrong scheme', 'Basic abc'],
  ])(
    'protected endpoints need a valid token (%s) → 401',
    async (_c, header) => {
      const req = t.http().get('/api/me');
      const res = await (
        header ? req.set('Authorization', header) : req
      ).expect(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    },
  );

  it('health stays public', async () => {
    await t.http().get('/api/health').expect(200);
  });
});
