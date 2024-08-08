import type { Socket } from 'node:net';
import type { BufferReader } from 'pg-protocol/dist/buffer-reader';
import type { Writer } from 'pg-protocol/dist/buffer-writer';
import { BackendMessageCode } from '../message-codes';
import { BaseAuthFlow } from './base-auth-flow';

export type PasswordAuthOptions = {
  method: 'password';
  validateCredentials: (credentials: {
    user: string;
    password: string;
  }) => boolean | Promise<boolean>;
};

export class PasswordAuthFlow extends BaseAuthFlow {
  private auth: PasswordAuthOptions;
  private username: string;
  private completed = false;

  constructor(params: {
    auth: PasswordAuthOptions;
    username: string;
    socket: Socket;
    reader: BufferReader;
    writer: Writer;
  }) {
    super(params);
    this.auth = params.auth;
    this.username = params.username;
  }

  async handleClientMessage(message: Buffer): Promise<void> {
    const length = this.reader.int32();
    const password = this.reader.cstring();

    this.socket.pause();
    const isValid = await this.auth.validateCredentials({
      user: this.username,
      password,
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
    this.sendAuthenticationCleartextPassword();
  }

  get isCompleted(): boolean {
    return this.completed;
  }

  /**
   * Sends an "AuthenticationCleartextPassword" message to the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONCLEARTEXTPASSWORD
   */
  private sendAuthenticationCleartextPassword() {
    this.writer.addInt32(3);
    const response = this.writer.flush(
      BackendMessageCode.AuthenticationResponse,
    );
    this.socket.write(response);
  }
}
