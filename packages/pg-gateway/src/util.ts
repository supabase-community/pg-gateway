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
  salt: string,
  iterations: number,
  clientProof: string,
  authMessage: string
}): boolean {
  const { password, salt, iterations, clientProof, authMessage } = params;

  // Convert salt and clientProof from base64 to Buffer
  const saltBuffer = Buffer.from(salt, 'base64');
  const clientProofBuffer = Buffer.from(clientProof, 'base64');

  // Derive the salted password
  const saltedPassword = pbkdf2Sync(password, saltBuffer, iterations, 32, 'sha256');

  // Compute the client key
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();

  // Compute the stored key
  const storedKey = createHash('sha256').update(clientKey).digest();

  // Compute the client signature
  const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();

  // Compute the client proof
  const computedClientProof = Buffer.alloc(clientSignature.length);
  for (let i = 0; i < clientSignature.length; i++) {
    computedClientProof[i] = clientKey[i] ^ clientSignature[i];
  }

  // Compare the computed proof with the provided proof
  return timingSafeEqual(clientProofBuffer, computedClientProof);
}