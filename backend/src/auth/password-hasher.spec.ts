import { hashPassword, verifyPassword } from './password-hasher';

describe('password hasher (scrypt)', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('parking123');
    await expect(verifyPassword('parking123', hash)).resolves.toBe(true);
    await expect(verifyPassword('parking124', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('stores algorithm, parameters, salt and key, never the password', async () => {
    const hash = await hashPassword('parking123');
    expect(hash).toMatch(
      /^scrypt\$131072\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{86}==$/,
    );
    expect(hash).not.toContain('parking123');
  });

  it('uses a random salt: the same password hashes differently', async () => {
    const [a, b] = await Promise.all([
      hashPassword('parking123'),
      hashPassword('parking123'),
    ]);
    expect(a).not.toBe(b);
  });

  it.each([
    ['empty string', ''],
    ['other algorithm', 'bcrypt$2b$10$abc'],
    ['missing parts', 'scrypt$131072$8$1$c2FsdA=='],
    ['non-numeric cost', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='],
    ['absurd cost', 'scrypt$1099511627776$8$1$c2FsdA==$aGFzaA=='],
  ])('treats a malformed hash as a mismatch (%s)', async (_c, stored) => {
    await expect(verifyPassword('parking123', stored)).resolves.toBe(false);
  });
});
