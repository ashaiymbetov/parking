import {
  addCar,
  createTestApp,
  createUser,
  resetDomainData,
  spotByCode,
  TestApp,
} from '../support/api';

describe('API: driver profile and cars', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp('2026-10-05T08:00:00Z');
  });
  afterAll(() => t.close());
  beforeEach(() => resetDomainData(t.ds));

  it('stores the normalized plate', async () => {
    const driver = await createUser(t);
    const res = await t
      .http()
      .post('/api/me/cars')
      .set(driver.auth)
      .send({ plate: ' а 123-вс ' })
      .expect(201);
    expect(res.body).toEqual({ id: expect.any(String), plate: 'A123BC' });

    const me = await t.http().get('/api/me').set(driver.auth).expect(200);
    expect(me.body.cars).toEqual([{ id: res.body.id, plate: 'A123BC' }]);
  });

  it('«а123вс» and «A123BC» are one car: the second add is rejected', async () => {
    const driver = await createUser(t);
    await addCar(t, driver, 'а123вс');

    const res = await t
      .http()
      .post('/api/me/cars')
      .set(driver.auth)
      .send({ plate: 'A123BC' })
      .expect(409);
    expect(res.body.code).toBe('CAR_ALREADY_ADDED');

    const cars = await t
      .http()
      .get('/api/me/cars')
      .set(driver.auth)
      .expect(200);
    expect(cars.body).toHaveLength(1);
  });

  it('a plate belongs to one profile: another driver gets PLATE_TAKEN', async () => {
    const alice = await createUser(t);
    const bob = await createUser(t);
    await addCar(t, alice, 'A123BC');

    const res = await t
      .http()
      .post('/api/me/cars')
      .set(bob.auth)
      .send({ plate: 'а123вс' })
      .expect(409);
    expect(res.body.code).toBe('PLATE_TAKEN');
  });

  it.each(['Ж123ВС', '', '   ', 'A1!', 'A'.repeat(16)])(
    'rejects a plate that cannot be normalized: %j → 422',
    async (plate) => {
      const driver = await createUser(t);
      const res = await t
        .http()
        .post('/api/me/cars')
        .set(driver.auth)
        .send({ plate })
        .expect(422);
      expect(['INVALID_PLATE', 'VALIDATION_FAILED']).toContain(res.body.code);
    },
  );

  it('lists only my cars', async () => {
    const alice = await createUser(t);
    const bob = await createUser(t);
    await addCar(t, alice, 'A111AA');
    await addCar(t, bob, 'B222BB');

    const res = await t.http().get('/api/me/cars').set(alice.auth).expect(200);
    expect(res.body.map((c: { plate: string }) => c.plate)).toEqual(['A111AA']);
  });

  describe('deleting a car (D-026)', () => {
    it('a car without history can be deleted', async () => {
      const driver = await createUser(t);
      const car = await addCar(t, driver, 'A123BC');
      await t
        .http()
        .delete(`/api/me/cars/${car.id}`)
        .set(driver.auth)
        .expect(204);
      const cars = await t
        .http()
        .get('/api/me/cars')
        .set(driver.auth)
        .expect(200);
      expect(cars.body).toEqual([]);
    });

    it('a car with a booking cannot be deleted', async () => {
      const driver = await createUser(t);
      const car = await addCar(t, driver, 'A123BC');
      await t
        .http()
        .post('/api/bookings')
        .set(driver.auth)
        .send({
          carId: car.id,
          spotId: await spotByCode(t, 'A01'),
          from: '2026-10-05T10:00:00Z',
          to: '2026-10-05T11:00:00Z',
        })
        .expect(201);

      const res = await t
        .http()
        .delete(`/api/me/cars/${car.id}`)
        .set(driver.auth)
        .expect(409);
      expect(res.body.code).toBe('CAR_HAS_HISTORY');
    });

    it("someone else's car is not found", async () => {
      const alice = await createUser(t);
      const bob = await createUser(t);
      const car = await addCar(t, alice, 'A123BC');
      await t.http().delete(`/api/me/cars/${car.id}`).set(bob.auth).expect(404);
    });
  });
});
