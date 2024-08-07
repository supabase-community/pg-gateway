import {
  type BinaryLike,
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

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

export type SaslMetadata = {
  salt: string;
  iterations: number;
  storedKey: string;
  serverKey: string;
};

/**
 * Creates SASL metadata for password authentication.
 * @see https://www.postgresql.org/docs/current/sasl-authentication.html
 */
export function createSaslMetadata(
  password: string,
  iterations = 4096,
): SaslMetadata {
  const salt = randomBytes(16).toString('base64');
  const saltBuffer = Buffer.from(salt, 'base64');
  const saltedPassword = pbkdf2Sync(
    password,
    saltBuffer,
    iterations,
    32,
    'sha256',
  );

  const clientKey = createHmac('sha256', saltedPassword)
    .update('Client Key')
    .digest();
  const storedKey = createHash('sha256').update(clientKey).digest();

  const serverKey = createHmac('sha256', saltedPassword)
    .update('Server Key')
    .digest();

  return {
    salt,
    iterations,
    storedKey: storedKey.toString('base64'),
    serverKey: serverKey.toString('base64'),
  };
}

/**
 * Verifies a SASL password using the provided parameters.
 * @see https://www.postgresql.org/docs/current/sasl-authentication.html
 */
export function verifySaslPassword(params: {
  authMessage: string;
  clientProof: string;
  storedKey: string;
}) {
  const { authMessage, clientProof, storedKey } = params;
  const clientProofBuffer = Buffer.from(clientProof, 'base64');
  const storedKeyBuffer = Buffer.from(storedKey, 'base64');

  const clientSignature = createHmac('sha256', storedKeyBuffer)
    .update(authMessage)
    .digest();
  const clientKey = Buffer.alloc(clientProofBuffer.length);
  for (let i = 0; i < clientProofBuffer.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    clientKey[i] = clientProofBuffer[i]! ^ clientSignature[i]!;
  }

  const computedStoredKey = createHash('sha256').update(clientKey).digest();

  return timingSafeEqual(storedKeyBuffer, computedStoredKey);
}
