import {
  randomBytes,
  scrypt,
  ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';

/**
 * scrypt from node:crypto (D-022). Parameters follow the OWASP Password
 * Storage Cheat Sheet: N=2^17, r=8, p=1. They are stored with every hash,
 * so they can be raised later without breaking existing passwords.
 *
 * Format: scrypt$N$r$p$<salt base64>$<key base64>
 */
const PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_N = 2 ** 20;

/** Memory scrypt needs is 128·N·r bytes; Node's default cap (32 MiB) is too low. */
function maxmem(N: number, r: number): number {
  return 128 * N * r * 2;
}

function derive(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions & { N: number; r: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keylen,
      { ...opts, maxmem: maxmem(opts.N, opts.r) },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/** Returns false for a wrong password and for any malformed stored hash. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const valid =
    [N, r, p].every(Number.isSafeInteger) &&
    N > 1 &&
    N <= MAX_N &&
    (N & (N - 1)) === 0 &&
    r > 0 &&
    p > 0 &&
    salt.length > 0 &&
    expected.length > 0;
  if (!valid) return false;

  const actual = await derive(password, salt, expected.length, { N, r, p });
  return timingSafeEqual(actual, expected);
}
