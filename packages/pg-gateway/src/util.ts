import { createHash, createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto';

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

export function verifySaslPassword(params: {
  password: string,
  salt: Buffer,
  iterations: number,
  clientProof: Buffer,
  authMessage: string
}): boolean {
  const { password, salt, iterations, clientProof, authMessage } = params;

  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  
  const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
  const computedClientProof = Buffer.alloc(clientSignature.length);
  for (let i = 0; i < clientSignature.length; i++) {
    computedClientProof[i] = clientKey[i] ^ clientSignature[i];
  }

  return timingSafeEqual(clientProof, computedClientProof);
}