import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export type ScramSha256Data = {
  salt: string;
  iterations: number;
  storedKey: string;
  serverKey: string;
};

export type ScramSha256Auth = {
  method: 'scram-sha-256';
  validateCredentials?: (params: {
    authMessage: string;
    clientProof: string;
    username: string;
    scramSha256Data: ScramSha256Data;
  }) => boolean | Promise<boolean>;
  getScramSha256Data: (params: {
    username: string;
  }) => ScramSha256Data | Promise<ScramSha256Data>;
};

/**
 * Creates scram-sha-256 data for password authentication.
 * @see https://www.postgresql.org/docs/current/sasl-authentication.html
 */
export function createScramSha256Data(
  password: string,
  iterations = 4096,
): ScramSha256Data {
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
 * Verifies a scram-sha-256 password using the provided parameters.
 * @see https://www.postgresql.org/docs/current/sasl-authentication.html
 */
export function verifyScramSha256Password(params: {
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

export class CreateServerFinalMessageError extends Error {}
export class InvalidClientFinalMessage extends CreateServerFinalMessageError {
  override message = 'Invalid client final message';
}
export class NonceMismatch extends CreateServerFinalMessageError {
  override message = 'Nonce mismatch';
}
export class InvalidCredentials extends CreateServerFinalMessageError {
  override message = 'Invalid credentials';
}

export class ScramSha256Flow {
  username: string;
  validateCredentials: (params: {
    authMessage: string;
    clientProof: string;
    username: string;
    scramSha256Data: ScramSha256Data;
  }) => boolean | Promise<boolean>;
  getData: (params: {
    username: string;
  }) => ScramSha256Data | Promise<ScramSha256Data>;
  clientFirstMessageBare?: string;
  serverFirstMessage?: string;
  serverNonce?: string;

  constructor(props: {
    username: string;
    getData: (params: {
      username: string;
    }) => ScramSha256Data | Promise<ScramSha256Data>;
    validateCredentials?: (params: {
      authMessage: string;
      clientProof: string;
      username: string;
      scramSha256Data: ScramSha256Data;
    }) => boolean | Promise<boolean>;
  }) {
    this.username = props.username;
    this.getData = props.getData;
    this.validateCredentials =
      props.validateCredentials ??
      (({ authMessage, clientProof, scramSha256Data: { storedKey } }) => {
        return verifyScramSha256Password({
          authMessage,
          clientProof,
          storedKey,
        });
      });
  }

  async createServerFirstMessage(clientFirstMessage: string) {
    const clientFirstMessageParts = clientFirstMessage.split(',');
    this.clientFirstMessageBare = clientFirstMessageParts.slice(2).join(',');
    const clientNonce =
      clientFirstMessageParts
        .find((part) => part.startsWith('r='))
        ?.substring(2) || '';

    // Generate server nonce by appending random bytes to client nonce
    const serverNoncePart = randomBytes(18).toString('base64');
    this.serverNonce = clientNonce + serverNoncePart;

    const { salt, iterations } = await this.getData({
      username: this.username,
    });
    this.serverFirstMessage = `r=${this.serverNonce},s=${salt},i=${iterations}`;

    return this.serverFirstMessage;
  }

  async createServerFinalMessage(clientFinalMessage: string) {
    const clientFinalMessageParts = clientFinalMessage.split(',');
    const channelBinding = clientFinalMessageParts
      .find((part) => part.startsWith('c='))
      ?.substring(2);
    const fullNonce = clientFinalMessageParts
      .find((part) => part.startsWith('r='))
      ?.substring(2);
    const clientProof = clientFinalMessageParts
      .find((part) => part.startsWith('p='))
      ?.substring(2);

    if (!channelBinding || !fullNonce || !clientProof) {
      throw new InvalidClientFinalMessage();
    }

    // Verify that the nonce matches what we expect
    if (fullNonce !== this.serverNonce) {
      throw new NonceMismatch();
    }

    // Reconstruct the client-final-message-without-proof
    const clientFinalMessageWithoutProof = `c=${channelBinding},r=${fullNonce}`;

    // Construct the full authMessage
    const authMessage = `${this.clientFirstMessageBare},${this.serverFirstMessage},${clientFinalMessageWithoutProof}`;

    const data = await this.getData({
      username: this.username,
    });

    const isValid = await this.validateCredentials({
      authMessage,
      clientProof,
      username: this.username,
      scramSha256Data: data,
    });

    if (!isValid) {
      throw new InvalidCredentials();
    }

    const serverSignature = createHmac(
      'sha256',
      Buffer.from(data.serverKey, 'base64'),
    )
      .update(authMessage)
      .digest();

    return `v=${serverSignature.toString('base64')}`;
  }
}
