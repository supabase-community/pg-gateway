import { crypto } from '@std/crypto';
import { encodeHex } from '@std/encoding/hex';
import { createBackendErrorMessage } from '../backend-error.js';
import type { BufferReader } from '../buffer-reader.js';
import type { BufferWriter } from '../buffer-writer.js';
import type { ConnectionState } from '../connection.types';
import { BackendMessageCode } from '../message-codes';
import { BaseAuthFlow } from './base-auth-flow';
import { concat } from '@std/bytes/concat';

export type Md5AuthOptions = {
  method: 'md5';
  validateCredentials?: (
    credentials: {
      username: string;
      preHashedPassword: string;
      salt: BufferSource;
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
  private completed = false;

  constructor(params: {
    auth: Md5AuthOptions;
    username: string;
    reader: BufferReader;
    writer: BufferWriter;
    connectionState: ConnectionState;
  }) {
    super(params);
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

  async *handleClientMessage(message: BufferSource) {
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
      yield createBackendErrorMessage({
        severity: 'FATAL',
        code: '28P01',
        message: `password authentication failed for user "${this.username}"`,
      });
      throw new Error('end socket');
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
export async function hashPreHashedPassword(preHashedPassword: string, salt: BufferSource) {
  const hash = await md5(
    concat([
      new TextEncoder().encode(preHashedPassword),
      salt instanceof ArrayBuffer
        ? new Uint8Array(salt)
        : new Uint8Array(salt.buffer, salt.byteOffset, salt.byteLength),
    ]),
  );
  return `md5${hash}`;
}

/**
 * Computes the MD5 hash of the given value.
 */
export async function md5(value: string | BufferSource) {
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
