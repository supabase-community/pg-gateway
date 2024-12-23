import { concat } from '@std/bytes/concat';
import { crypto } from '@std/crypto';
import { encodeHex } from '@std/encoding/hex';
import { BackendError } from '../backend-error.js';
import type { BufferReader } from '../buffer-reader.js';
import type { BufferWriter } from '../buffer-writer.js';
import type { ConnectionState } from '../connection.types';
import { BackendMessageCode } from '../message-codes';
import { closeSignal } from '../signals.js';
import { BaseAuthFlow } from './base-auth-flow';

export type Md5AuthOptions = {
  method: 'md5';
  validateCredentials?: (
    credentials: {
      username: string;
      preHashedPassword: string;
      salt: Uint8Array;
      hashedPassword: string;
    },
    connectionState: ConnectionState,
  ) => boolean | Promise<boolean>;
  getPreHashedPassword: (
    credentials: { username: string },
    connectionState: ConnectionState,
  ) => string | Promise<string>;
};

export class Md5AuthFlow extends BaseAuthFlow {
  private auth: Md5AuthOptions & {
    validateCredentials: NonNullable<Md5AuthOptions['validateCredentials']>;
  };
  private username: string;
  private salt: Uint8Array;
  private completed: boolean;

  constructor(params: {
    auth: Md5AuthOptions;
    username: string;
    reader: BufferReader;
    writer: BufferWriter;
    connectionState: ConnectionState;
  }) {
    super(params);

    this.completed = false;
    this.auth = {
      ...params.auth,
      validateCredentials:
        params.auth.validateCredentials ??
        (async ({ preHashedPassword, hashedPassword, salt }) => {
          const expectedHashedPassword = await hashPreHashedPassword(preHashedPassword, salt);
          return hashedPassword === expectedHashedPassword;
        }),
    };
    this.username = params.username;
    this.salt = generateMd5Salt();
  }

  async *handleClientMessage(message: Uint8Array) {
    const length = this.reader.int32();
    const hashedPassword = this.reader.cstring();

    const preHashedPassword = await this.auth.getPreHashedPassword(
      {
        username: this.username,
      },
      this.connectionState,
    );
    const isValid = await this.auth.validateCredentials(
      {
        username: this.username,
        hashedPassword,
        preHashedPassword,
        salt: this.salt,
      },
      this.connectionState,
    );

    if (!isValid) {
      yield BackendError.create({
        severity: 'FATAL',
        code: '28P01',
        message: `password authentication failed for user "${this.username}"`,
      }).flush();
      yield closeSignal;
      return;
    }

    this.completed = true;
  }

  override createInitialAuthMessage() {
    return this.createAuthenticationMD5Password();
  }

  get isCompleted(): boolean {
    return this.completed;
  }

  /**
   * Creates the authentication response.
   *
   * @see https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-START-UP
   */
  private createAuthenticationMD5Password() {
    this.writer.addInt32(5);
    this.writer.add(Buffer.from(this.salt));

    return this.writer.flush(BackendMessageCode.AuthenticationResponse);
  }
}

/**
 * Hashes a password using Postgres' nested MD5 algorithm.
 *
 * @see https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-START-UP
 */
export async function hashPreHashedPassword(preHashedPassword: string, salt: Uint8Array) {
  const hash = await md5(concat([new TextEncoder().encode(preHashedPassword), salt]));
  return `md5${hash}`;
}

/**
 * Computes the MD5 hash of the given value.
 */
export async function md5(value: string | Uint8Array) {
  const hash = await crypto.subtle.digest(
    'MD5',
    typeof value === 'string' ? new TextEncoder().encode(value) : value,
  );

  return encodeHex(hash);
}

/**
 * Generates a random 4-byte salt for MD5 hashing.
 */
export function generateMd5Salt() {
  const salt = new Uint8Array(4);
  crypto.getRandomValues(salt);
  return salt;
}

export async function createPreHashedPassword(username: string, password: string) {
  return await md5(`${password}${username}`);
}
