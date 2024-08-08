import type { Socket } from 'node:net';
import type { BufferReader } from 'pg-protocol/dist/buffer-reader';
import type { Writer } from 'pg-protocol/dist/buffer-writer';
import {
  type BackendError,
  createBackendErrorMessage,
} from '../backend-error.js';
import type { ConnectionState } from '../connection.types.js';

export interface AuthFlow {
  sendInitialAuthMessage(): void;
  handleClientMessage(message: Buffer): Promise<void>;
  isCompleted: boolean;
}

export abstract class BaseAuthFlow implements AuthFlow {
  protected socket: Socket;
  protected reader: BufferReader;
  protected writer: Writer;
  protected connectionState: ConnectionState;

  constructor(params: {
    socket: Socket;
    reader: BufferReader;
    writer: Writer;
    connectionState: ConnectionState;
  }) {
    this.socket = params.socket;
    this.reader = params.reader;
    this.writer = params.writer;
    this.connectionState = params.connectionState;
  }

  abstract sendInitialAuthMessage(): void;
  abstract handleClientMessage(message: Buffer): Promise<void>;
  abstract get isCompleted(): boolean;

  protected sendError(error: BackendError) {
    const errorMessage = createBackendErrorMessage(error);
    this.socket.write(errorMessage);
  }
}
