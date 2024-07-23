import { createHash } from 'node:crypto';

/**
 * Hashes a password using Postgres' nested MD5 algorithm.
 *
 * @see https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-START-UP
 */
export async function hashMd5Password(
  user: string,
  password: string,
  salt: Uint8Array
) {
  const inner = await md5(password + user);
  const outer = await md5(Buffer.concat([Buffer.from(inner), salt]));
  return 'md5' + outer;
}

export async function md5(value: string | Buffer) {
  return createHash('md5').update(value).digest('hex');
}

export function generateMd5Salt() {
  const salt = new Uint8Array(4);
  crypto.getRandomValues(salt);
  return salt;
}
