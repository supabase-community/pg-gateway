import { type BinaryLike, createHash } from 'node:crypto';

export type Md5AuthOptions = {
  method: 'md5';
  validateCredentials: (credentials: {
    user: string;
    hash: string;
    salt: Uint8Array;
  }) => boolean | Promise<boolean>;
};

/**
 * Hashes a password using Postgres' nested MD5 algorithm.
 * @see https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-START-UP
 */
export async function hashMd5Password(
  user: string,
  password: string,
  salt: Uint8Array,
) {
  const inner = md5(password + user);
  const outer = md5(Buffer.concat([Buffer.from(inner), salt]));
  return `md5${outer}`;
}

/**
 * Computes the MD5 hash of the given value.
 */
export function md5(value: BinaryLike) {
  return createHash('md5').update(value).digest('hex');
}

/**
 * Generates a random 4-byte salt for MD5 hashing.
 */
export function generateMd5Salt() {
  const salt = new Uint8Array(4);
  crypto.getRandomValues(salt);
  return salt;
}
