import { type BinaryLike, createHash } from 'node:crypto';
import type { Socket } from 'node:net';
import type { BufferReader } from 'pg-protocol/dist/buffer-reader';
import type { Writer } from 'pg-protocol/dist/buffer-writer';
import { BackendMessageCode } from '../message-codes';
import { BaseAuthFlow } from './base-auth-flow';

export type Md5AuthOptions = {
  method: 'md5';
  validateCredentials: (credentials: {
    user: string;
    hash: string;
    salt: Buffer;
  }) => boolean | Promise<boolean>;
};

export class Md5AuthFlow extends BaseAuthFlow {
  private auth: Md5AuthOptions;
  private username: string;
  private salt: Buffer;
  private completed = false;

  constructor(params: {
    auth: Md5AuthOptions;
    username: string;
    salt?: Buffer;
    socket: Socket;
    reader: BufferReader;
    writer: Writer;
  }) {
    super(params);
    this.auth = params.auth;
    this.username = params.username;
    this.salt = params.salt ?? generateMd5Salt();
  }

  async handleClientMessage(message: Buffer): Promise<void> {
    const length = this.reader.int32();
    const md5Password = this.reader.cstring();

    this.socket.pause();
    const isValid = await this.auth.validateCredentials({
      user: this.username,
      hash: md5Password,
      salt: this.salt,
    });
    this.socket.resume();

    if (!isValid) {
      this.sendError({
        severity: 'FATAL',
        code: '28P01',
        message: `password authentication failed for user "${this.username}"`,
      });
      this.socket.end();
      return;
    }

    this.completed = true;
  }

  override sendInitialAuthMessage(): void {
    this.sendAuthenticationMD5Password();
  }

  get isCompleted(): boolean {
    return this.completed;
  }

  /**
   * Sends the authentication response to the client.
   *
   * @see https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-START-UP
   */
  private sendAuthenticationMD5Password(): void {
    this.writer.addInt32(5);
    this.writer.add(Buffer.from(this.salt));

    const response = this.writer.flush(
      BackendMessageCode.AuthenticationResponse,
    );

    this.socket.write(response);
  }
}

/**
 * Hashes a password using Postgres' nested MD5 algorithm.
 *
 * @see https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-START-UP
 */
export async function hashMd5Password(
  user: string,
  password: string,
  salt: Buffer,
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
  const salt = Buffer.alloc(4);
  crypto.getRandomValues(salt);
  return salt;
}
