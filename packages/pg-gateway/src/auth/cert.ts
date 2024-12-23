import { BackendError } from '../backend-error.js';
import type { BufferReader } from '../buffer-reader.js';
import type { BufferWriter } from '../buffer-writer.js';
import type { ConnectionState } from '../connection.types';
import { closeSignal } from '../signals.js';
import { BaseAuthFlow } from './base-auth-flow';

export type CertAuthOptions = {
  method: 'cert';
  validateCredentials?: (
    credentials: {
      username: string;
      certificate: Uint8Array;
    },
    connectionState: ConnectionState,
  ) => boolean | Promise<boolean>;
};

export class CertAuthFlow extends BaseAuthFlow {
  private auth: CertAuthOptions & {
    validateCredentials: NonNullable<CertAuthOptions['validateCredentials']>;
  };
  private username: string;
  private completed: boolean;

  constructor(params: {
    auth: CertAuthOptions;
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
        (() => {
          throw new Error('Client certificate validation not implemented');
        }),
    };
    this.username = params.username;
  }

  async *handleClientMessage(message: BufferSource) {
    if (!this.connectionState.tlsInfo) {
      yield BackendError.create({
        severity: 'FATAL',
        code: '08000',
        message: `ssl connection required when auth mode is 'certificate'`,
      }).flush();
      yield closeSignal;
      return;
    }

    if (!this.connectionState.tlsInfo.clientCertificate) {
      yield BackendError.create({
        severity: 'FATAL',
        code: '08000',
        message: 'client certificate required',
      }).flush();
      yield closeSignal;
      return;
    }

    const isValid = await this.auth.validateCredentials(
      {
        username: this.username,
        certificate: this.connectionState.tlsInfo.clientCertificate,
      },
      this.connectionState,
    );

    if (!isValid) {
      yield BackendError.create({
        severity: 'FATAL',
        code: '08000',
        message: 'client certificate is invalid',
      }).flush();
      yield closeSignal;
      return;
    }

    this.completed = true;
  }

  override createInitialAuthMessage() {
    return undefined;
  }

  get isCompleted(): boolean {
    return this.completed;
  }
}
