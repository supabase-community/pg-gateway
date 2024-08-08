import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { BufferReader } from 'pg-protocol/dist/buffer-reader';
import { Writer } from 'pg-protocol/dist/buffer-writer';

import type { AuthFlow } from './auth/base-auth-flow.js';
import { type AuthOptions, createAuthFlow } from './auth/index.js';
import {
  type BackendError,
  createBackendErrorMessage,
} from './backend-error.js';
import type {
  ClientInfo,
  ConnectionState,
  TlsInfo,
} from './connection.types.js';
import { MessageBuffer } from './message-buffer.js';
import { BackendMessageCode, FrontendMessageCode } from './message-codes.js';
import { upgradeTls } from './tls.js';

export type TlsOptions = {
  key: Buffer;
  cert: Buffer;
  ca?: Buffer;
  passphrase?: string;
};

export type TlsOptionsCallback = (
  tlsInfo: TlsInfo,
) => TlsOptions | Promise<TlsOptions>;

export type PostgresConnectionOptions = {
  /**
   * The server version to send to the frontend.
   */
  serverVersion?: string;

  /**
   * The authentication mode for the server.
   */
  auth?: AuthOptions;

  /**
   * TLS options for when clients send an SSLRequest.
   */
  tls?: TlsOptions | TlsOptionsCallback;

  /**
   * Callback after the connection has been upgraded to TLS.
   *
   * Includes `state` which holds connection information gathered so far like `tlsInfo`.
   *
   * This will be called before the startup message is received from the frontend
   * (if TLS is being used) so is a good place to establish proxy connections if desired.
   */
  onTlsUpgrade?(state: ConnectionState): void | Promise<void>;

  /**
   * Callback after the initial startup message has been received from the frontend.
   *
   * Includes `state` which holds connection information gathered so far like `clientInfo`.
   *
   * This is called after the connection is upgraded to TLS (if TLS is being used)
   * but before authentication messages are sent to the frontend.
   *
   * Callback should return `true` to indicate that it has responded to the startup
   * message and no further processing should occur. Return `false` to continue
   * built-in processing.
   *
   * **Warning:** By managing the post-startup response yourself (returning `true`),
   * you bypass further processing by the `PostgresConnection` which means some state
   * may not be collected and hooks won't be called.
   */
  onStartup?(state: ConnectionState): boolean | Promise<boolean>;

  /**
   * Callback after a successful authentication has completed.
   *
   * Includes `state` which holds connection information gathered so far.
   */
  onAuthenticated?(state: ConnectionState): void | Promise<void>;

  /**
   * Callback for every message received from the frontend.
   * Use this as an escape hatch to manually handle raw message data.
   *
   * Includes `state` which holds connection information gathered so far and
   * can be used to understand where the protocol is at in its lifecycle.
   *
   * Callback should return `true` to indicate that it has responded to the message
   * and no further processing should occur. Return `false` to continue
   * built-in processing.
   *
   * **Warning:** By managing the message yourself (returning `true`), you bypass further
   * processing by the `PostgresConnection` which means some state may not be collected
   * and hooks won't be called depending on where the protocol is at in its lifecycle.
   */
  onMessage?(
    data: Uint8Array,
    state: ConnectionState,
  ): boolean | Promise<boolean>;

  /**
   * Callback for every frontend query message.
   * Use this to implement query handling.
   *
   * If left `undefined`, an error will be sent to the frontend
   * indicating that queries aren't implemented.
   *
   * TODO: change return signature to be more developer-friendly
   * and then translate to wire protocol.
   */
  onQuery?(
    query: string,
    state: ConnectionState,
  ): Uint8Array | Promise<Uint8Array>;
};

export const ServerStep = {
  AwaitingInitialMessage: 'AwaitingInitialMessage',
  PerformingAuthentication: 'PerformingAuthentication',
  ReadyForQuery: 'ReadyForQuery',
} as const;

export type ServerStep = (typeof ServerStep)[keyof typeof ServerStep];

export default class PostgresConnection {
  private step: ServerStep = ServerStep.AwaitingInitialMessage;
  options: PostgresConnectionOptions & {
    auth: NonNullable<PostgresConnectionOptions['auth']>;
  };
  authFlow?: AuthFlow;
  secureSocket?: TLSSocket;
  hasStarted = false;
  isAuthenticated = false;
  writer = new Writer();
  reader = new BufferReader();
  clientInfo?: ClientInfo;
  tlsInfo?: TlsInfo;
  messageBuffer = new MessageBuffer();
  boundDataHandler: (data: Buffer) => Promise<void>;

  constructor(
    public socket: Socket,
    options: PostgresConnectionOptions = {},
  ) {
    this.options = {
      auth: { method: 'trust' },
      ...options,
    };
    this.boundDataHandler = this.handleData.bind(this);
    this.createSocketHandlers(socket);
  }

  get state(): ConnectionState {
    return {
      hasStarted: this.hasStarted,
      isAuthenticated: this.isAuthenticated,
      clientInfo: this.clientInfo,
      tlsInfo: this.tlsInfo,
    };
  }

  createSocketHandlers(socket: Socket) {
    socket.on('data', this.boundDataHandler);
    socket.on('error', this.handleSocketError);
  }

  handleSocketError = (error: Error) => {
    // Ignore EPIPE and ECONNRESET errors as they are normal when the client disconnects
    if (
      'code' in error &&
      (error.code === 'EPIPE' || error.code === 'ECONNRESET')
    ) {
      return;
    }

    console.error('Socket error:', error);
  };

  removeSocketHandlers(socket: Socket) {
    socket.off('data', this.boundDataHandler);
    socket.off('error', this.handleSocketError);
  }

  /**
   * Detaches the `PostgresConnection` from the socket.
   * After calling this, no more handlers will be called
   * and data will no longer be buffered.
   *
   * @returns The underlying socket (which could have been upgraded to a `TLSSocket`)
   */
  detach() {
    this.removeSocketHandlers(this.socket);
    return this.socket;
  }

  /**
   * Processes incoming data by buffering it and parsing messages.
   *
   * Inspired by https://github.com/brianc/node-postgres/blob/54eb0fa216aaccd727765641e7d1cf5da2bc483d/packages/pg-protocol/src/parser.ts#L91-L119
   */
  async handleData(data: Buffer) {
    try {
      this.messageBuffer.mergeBuffer(data);
      await this.messageBuffer.processMessages(
        this.handleClientMessage.bind(this),
        this.hasStarted,
      );
    } catch (err) {
      console.error(err);
    }
  }

  async handleClientMessage(message: Buffer): Promise<void> {
    this.reader.setBuffer(0, message);

    this.socket.pause();
    const messageSkip = await this.options.onMessage?.(message, this.state);
    this.socket.resume();

    if (messageSkip) {
      if (this.isStartupMessage(message)) {
        this.hasStarted = true;
      }
      return;
    }

    switch (this.step) {
      case ServerStep.AwaitingInitialMessage:
        if (this.isSslRequest(message)) {
          await this.handleSslRequest();
        } else if (this.isStartupMessage(message)) {
          // the next step is determined by handleStartupMessage
          this.handleStartupMessage(message);
        } else {
          throw new Error('Unexpected initial message');
        }
        break;

      case ServerStep.PerformingAuthentication:
        if ((await this.handleAuthenticationMessage(message)) === true) {
          await this.completeAuthentication();
        }
        break;

      case ServerStep.ReadyForQuery:
        await this.handleRegularMessage(message);
        break;

      default:
        throw new Error(`Unexpected step: ${this.step}`);
    }
  }

  async handleSslRequest() {
    if (!this.options.tls) {
      this.writer.addString('N');
      const result = this.writer.flush();
      this.sendData(result);
      return;
    }

    // Otherwise respond with 'S' to indicate it is supported
    this.writer.addString('S');
    const result = this.writer.flush();
    this.sendData(result);

    // From now on the frontend will communicate via TLS, so upgrade the connection
    await this.upgradeToTls(this.options.tls);
  }

  async handleStartupMessage(message: Buffer) {
    const { majorVersion, minorVersion, parameters } =
      this.readStartupMessage();

    // user is required
    if (!parameters.user) {
      this.sendError({
        severity: 'FATAL',
        code: '08000',
        message: 'user is required',
      });
      this.socket.end();
      return;
    }

    if (majorVersion !== 3 || minorVersion !== 0) {
      this.sendError({
        severity: 'FATAL',
        code: '08000',
        message: `Unsupported protocol version ${majorVersion.toString()}.${minorVersion.toString()}`,
      });
      this.socket.end();
      return;
    }

    this.clientInfo = {
      majorVersion,
      minorVersion,
      parameters: {
        user: parameters.user,
        ...parameters,
      },
    };

    this.hasStarted = true;

    if (this.options.auth.method === 'trust') {
      await this.completeAuthentication();
      return;
    }

    this.authFlow = createAuthFlow({
      socket: this.socket,
      reader: this.reader,
      writer: this.writer,
      username: this.clientInfo.parameters.user,
      auth: this.options.auth,
      connectionState: this.state,
    });

    this.step = ServerStep.PerformingAuthentication;
    this.authFlow.sendInitialAuthMessage();

    // 'cert' auth flow is an edge case
    // it doesn't expect a new message from the client so we can directly proceed
    if (this.options.auth.method === 'cert') {
      await this.authFlow.handleClientMessage(message);
      if (this.authFlow.isCompleted) {
        await this.completeAuthentication();
      }
    }
  }

  async handleAuthenticationMessage(message: Buffer) {
    const code = this.reader.byte();

    if (code !== FrontendMessageCode.Password) {
      throw new Error(`Unexpected authentication message code: ${code}`);
    }

    if (!this.authFlow) {
      throw new Error('AuthFlow not initialized');
    }

    await this.authFlow.handleClientMessage(message);

    return this.authFlow.isCompleted;
  }

  private async handleRegularMessage(message: Buffer): Promise<void> {
    const code = this.reader.byte();

    switch (code) {
      case FrontendMessageCode.Terminate:
        this.handleTerminate(message);
        break;
      default:
        this.sendError({
          severity: 'ERROR',
          code: '123',
          message: 'Message code not yet implemented',
        });
        this.sendReadyForQuery('idle');
    }
  }

  handleTerminate(message: Buffer) {
    this.socket.end();
  }

  /**
   * Checks if the given message is a valid SSL request.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-SSLREQUEST
   */
  private isSslRequest(message: Buffer): boolean {
    if (message.length !== 8) return false;

    const mostSignificantPart = message.readInt16BE(4);
    const leastSignificantPart = message.readInt16BE(6);

    return mostSignificantPart === 1234 && leastSignificantPart === 5679;
  }

  /**
   * Checks if the given message is a valid StartupMessage.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-STARTUPMESSAGE
   */
  private isStartupMessage(message: Buffer): boolean {
    if (message.length < 8) return false;

    const length = message.readInt32BE(0);
    const majorVersion = message.readInt16BE(4);
    const minorVersion = message.readInt16BE(6);

    return (
      message.length === length && majorVersion === 3 && minorVersion === 0
    );
  }

  /**
   * Completes authentication by forwarding the appropriate messages
   * to the frontend.
   */
  async completeAuthentication() {
    this.isAuthenticated = true;
    this.sendAuthenticationOk();

    if (this.options.serverVersion) {
      this.sendParameterStatus('server_version', this.options.serverVersion);
    }

    this.step = ServerStep.ReadyForQuery;
    this.sendReadyForQuery('idle');

    // We must pause/resume the socket before/after each hook to prevent race conditions
    this.socket.pause();
    await this.options.onAuthenticated?.(this.state);
    this.socket.resume();
  }

  /**
   * Upgrades TCP socket connection to TLS.
   */
  async upgradeToTls(options: TlsOptions | TlsOptionsCallback) {
    const requestCert = this.options.auth.method === 'cert';

    const { secureSocket, tlsInfo } = await upgradeTls(
      this.socket,
      options,
      {},
      requestCert,
    );

    this.tlsInfo = tlsInfo;
    this.secureSocket = secureSocket;

    this.removeSocketHandlers(this.socket);
    this.createSocketHandlers(this.secureSocket);
    this.socket = this.secureSocket;

    await this.options.onTlsUpgrade?.(this.state);

    this.secureSocket.resume();
  }

  /**
   * Parses a startup message from the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-STARTUPMESSAGE
   */
  readStartupMessage() {
    const length = this.reader.int32();
    const majorVersion = this.reader.int16();
    const minorVersion = this.reader.int16();

    const parameters: Record<string, string> = {};

    // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
    for (let key: string; (key = this.reader.cstring()) !== ''; ) {
      parameters[key] = this.reader.cstring();
    }

    return {
      majorVersion,
      minorVersion,
      parameters,
    };
  }

  /**
   * Parses a query message from the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-QUERY
   */
  readQuery() {
    const query = this.reader.cstring();

    return {
      query,
    };
  }

  /**
   * Sends raw data to the frontend.
   */
  sendData(data: Uint8Array) {
    this.socket.write(data);
  }

  /**
   * Sends an "AuthenticationOk" message to the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONOK
   */
  sendAuthenticationOk() {
    this.writer.addInt32(0);
    const response = this.writer.flush(
      BackendMessageCode.AuthenticationResponse,
    );
    this.sendData(response);
  }

  /**
   * Sends an "ParameterStatus" message to the frontend.
   * Informs the frontend about the current setting of backend parameters.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARAMETERSTATUS
   * @see https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-ASYNC
   */
  sendParameterStatus(name: string, value: string) {
    this.writer.addCString(name);
    this.writer.addCString(value);
    const response = this.writer.flush(BackendMessageCode.ParameterStatus);
    this.sendData(response);
  }

  /**
   * Sends a "ReadyForQuery" message to the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-READYFORQUERY
   */
  sendReadyForQuery(
    transactionStatus: 'idle' | 'transaction' | 'error' = 'idle',
  ) {
    switch (transactionStatus) {
      case 'idle':
        this.writer.addString('I');
        break;
      case 'transaction':
        this.writer.addString('T');
        break;
      case 'error':
        this.writer.addString('E');
        break;
      default:
        throw new Error(`Unknown transaction status '${transactionStatus}'`);
    }

    const response = this.writer.flush(BackendMessageCode.ReadyForQuery);
    this.sendData(response);
  }

  /**
   * Sends an error message to the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-ERRORRESPONSE
   *
   * For error fields, see https://www.postgresql.org/docs/current/protocol-error-fields.html#PROTOCOL-ERROR-FIELDS
   */
  sendError(error: BackendError) {
    const errorMessage = createBackendErrorMessage(error);
    this.sendData(errorMessage);
  }

  sendAuthenticationFailedError() {
    this.sendError({
      severity: 'FATAL',
      code: '28P01',
      message: this.clientInfo?.parameters.user
        ? `password authentication failed for user "${this.clientInfo.parameters.user}"`
        : 'password authentication failed',
    });
  }
}
