import type { Socket } from 'node:net';
import type { TLSSocket, TLSSocketOptions } from 'node:tls';
import { BufferReader } from 'pg-protocol/dist/buffer-reader';
import { Writer } from 'pg-protocol/dist/buffer-writer';

import type { CertAuthOptions } from './auth/cert.js';
import type { AuthOptions } from './auth/index.js';
import type { Md5AuthOptions } from './auth/md5.js';
import { generateMd5Salt } from './auth/md5.js';
import type { PasswordAuthOptions } from './auth/password.js';
import { ScramSha256AuthFlow } from './auth/sasl/scram-sha-256.js';
import { MessageBuffer } from './message-buffer.js';
import { upgradeTls } from './tls.js';

export const FrontendMessageCode = {
  Query: 0x51, // Q
  Parse: 0x50, // P
  Bind: 0x42, // B
  Execute: 0x45, // E
  FunctionCall: 0x46, // F
  Flush: 0x48, // H
  Close: 0x43, // C
  Describe: 0x44, // D
  CopyFromChunk: 0x64, // d
  CopyDone: 0x63, // c
  CopyData: 0x64, // d
  CopyFail: 0x66, // f
  Password: 0x70, // p
  Sync: 0x53, // S
  Terminate: 0x58, // X
} as const;

export const BackendMessageCode = {
  DataRow: 0x44, // D
  ParseComplete: 0x31, // 1
  BindComplete: 0x32, // 2
  CloseComplete: 0x33, // 3
  CommandComplete: 0x43, // C
  ReadyForQuery: 0x5a, // Z
  NoData: 0x6e, // n
  NotificationResponse: 0x41, // A
  AuthenticationResponse: 0x52, // R
  ParameterStatus: 0x53, // S
  BackendKeyData: 0x4b, // K
  ErrorMessage: 0x45, // E
  NoticeMessage: 0x4e, // N
  RowDescriptionMessage: 0x54, // T
  ParameterDescriptionMessage: 0x74, // t
  PortalSuspended: 0x73, // s
  ReplicationStart: 0x57, // W
  EmptyQuery: 0x49, // I
  CopyIn: 0x47, // G
  CopyOut: 0x48, // H
  CopyDone: 0x63, // c
  CopyData: 0x64, // d
} as const;

/**
 * Modified from pg-protocol to require certain fields.
 */
export interface BackendError {
  severity: 'ERROR' | 'FATAL' | 'PANIC';
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;
}

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
  onTlsUpgrade?(state: State): void | Promise<void>;

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
  onStartup?(state: State): boolean | Promise<boolean>;

  /**
   * Callback after a successful authentication has completed.
   *
   * Includes `state` which holds connection information gathered so far.
   */
  onAuthenticated?(state: State): void | Promise<void>;

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
  onMessage?(data: Uint8Array, state: State): boolean | Promise<boolean>;

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
  onQuery?(query: string, state: State): Uint8Array | Promise<Uint8Array>;
};

export type ClientParameters = {
  user: string;
  [key: string]: string;
};

export type ClientInfo = {
  majorVersion: number;
  minorVersion: number;
  parameters: ClientParameters;
};

export type TlsInfo = {
  sniServerName?: string;
};

export type State = {
  hasStarted: boolean;
  isAuthenticated: boolean;
  clientInfo?: ClientInfo;
  tlsInfo?: TlsInfo;
};

export const ServerStep = {
  AwaitingInitialMessage: 'AwaitingInitialMessage',
  HandlingSslRequest: 'HandlingSslRequest',
  PerformingAuthentication: 'PerformingAuthentication',
  ReadyForQuery: 'ReadyForQuery',
} as const;

export type ServerStep = (typeof ServerStep)[keyof typeof ServerStep];

export default class PostgresConnection {
  private step: ServerStep = ServerStep.AwaitingInitialMessage;
  options: PostgresConnectionOptions & {
    auth: NonNullable<PostgresConnectionOptions['auth']>;
  };
  secureSocket?: TLSSocket;
  hasStarted = false;
  isAuthenticated = false;
  writer = new Writer();
  reader = new BufferReader();
  md5Salt = generateMd5Salt();
  clientInfo?: ClientInfo;
  tlsInfo?: TlsInfo;
  scramSha256AuthFlow?: ScramSha256AuthFlow;
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

  get state(): State {
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
      return;
    }

    switch (this.step) {
      case ServerStep.AwaitingInitialMessage:
        if (this.isSslRequest(message)) {
          this.step = ServerStep.HandlingSslRequest;
          await this.handleSslRequest();
        } else if (this.isStartupMessage(message)) {
          // the next step is determined by handleStartupMessage
          this.handleStartupMessage();
        } else {
          throw new Error('Unexpected initial message');
        }
        break;

      case ServerStep.HandlingSslRequest:
        if (this.isStartupMessage(message)) {
          // the next step is determined by handleStartupMessage
          this.handleStartupMessage();
        } else {
          throw new Error('Expected StartupMessage after SSL negotiation');
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
  sendServerParameters() {
    throw new Error('Method not implemented.');
  }
  sendBackendKeyData() {
    throw new Error('Method not implemented.');
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

  async handleStartupMessage() {
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

    switch (this.options.auth.method) {
      case 'trust':
        await this.completeAuthentication();
        break;
      case 'password':
        this.step = ServerStep.PerformingAuthentication;
        this.sendAuthenticationCleartextPassword();
        break;
      case 'md5':
        this.step = ServerStep.PerformingAuthentication;
        this.sendAuthenticationMD5Password(this.md5Salt);
        break;
      case 'scram-sha-256':
        this.scramSha256AuthFlow = new ScramSha256AuthFlow({
          socket: this.socket,
          reader: this.reader,
          writer: this.writer,
          auth: this.options.auth,
          username: this.clientInfo.parameters.user,
        });
        this.step = ServerStep.PerformingAuthentication;
        this.scramSha256AuthFlow.sendAuthenticationSASL();
        break;
      default:
        throw new Error(
          `Unsupported authentication method: ${this.options.auth.method}`,
        );
    }
  }

  async handleAuthenticationMessage(message: Buffer) {
    const code = this.reader.byte();
    if (code !== FrontendMessageCode.Password) {
      throw new Error(`Unexpected authentication message code: ${code}`);
    }
    switch (this.options.auth.method) {
      case 'password':
        return this.handlePasswordAuthenticationMessage(
          message,
          this.options.auth,
        );
      case 'md5':
        return this.handleMD5AuthenticationMessage(message, this.options.auth);
      case 'scram-sha-256':
        return this.handleScramSha256AuthenticationMessage(message);
      case 'cert':
        return this.handleCertAuthenticationMessage(message, this.options.auth);
      default:
        throw new Error(
          `Unsupported authentication method: ${this.options.auth.method}`,
        );
    }
  }

  async handleScramSha256AuthenticationMessage(message: Buffer) {
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    await this.scramSha256AuthFlow!.handleClientMessage(message);
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    return this.scramSha256AuthFlow!.isCompleted;
  }

  async handlePasswordAuthenticationMessage(
    message: Buffer,
    auth: PasswordAuthOptions,
  ) {
    const length = this.reader.int32();
    const password = this.reader.cstring();

    // We must pause/resume the socket before/after each hook to prevent race conditions
    this.socket.pause();
    const isValid = await auth.validateCredentials({
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      user: this.clientInfo!.parameters.user,
      password,
    });
    this.socket.resume();

    if (!isValid) {
      this.sendAuthenticationFailedError();
      this.socket.end();
      return;
    }

    return true;
  }

  async handleMD5AuthenticationMessage(message: Buffer, auth: Md5AuthOptions) {
    const length = this.reader.int32();
    const hash = this.reader.cstring();
    const isValid = await auth.validateCredentials({
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      user: this.clientInfo!.parameters.user,
      hash,
      salt: this.md5Salt,
    });

    if (!isValid) {
      this.sendAuthenticationFailedError();
      this.socket.end();
      return;
    }

    return true;
  }

  async handleCertAuthenticationMessage(
    message: Buffer,
    auth: CertAuthOptions,
  ) {
    if (!this.secureSocket) {
      this.sendError({
        severity: 'FATAL',
        code: '08000',
        message: `ssl connection required when auth mode is 'certificate'`,
      });
      this.socket.end();
      return;
    }

    if (!this.secureSocket.authorized) {
      this.sendError({
        severity: 'FATAL',
        code: '08000',
        message: 'client certificate is invalid',
      });
      this.socket.end();
      return;
    }

    const isValid = await auth.validateCredentials({
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      user: this.clientInfo!.parameters.user,
      certificate: this.secureSocket.getPeerCertificate(),
    });

    if (!isValid) {
      this.sendError({
        severity: 'FATAL',
        code: '08000',
        message: 'client certificate is invalid',
      });
      this.socket.end();
      return;
    }

    return true;
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

  private isSslRequest(message: Buffer): boolean {
    return message.length === 8 && message.readInt32BE(4) === 80877103;
  }

  private isStartupMessage(message: Buffer): boolean {
    // StartupMessage begins with length (Int32) followed by protocol version (Int32)
    return message.length > 8 && message.readInt32BE(4) === 196608; // 196608 is protocol version 3.0
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
   * Sends an "AuthenticationCleartextPassword" message to the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONCLEARTEXTPASSWORD
   */
  sendAuthenticationCleartextPassword() {
    this.writer.addInt32(3);
    const response = this.writer.flush(
      BackendMessageCode.AuthenticationResponse,
    );
    this.sendData(response);
  }

  /**
   * Sends an "AuthenticationMD5Password" message to the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONMD5PASSWORD
   */
  sendAuthenticationMD5Password(salt: ArrayBuffer) {
    this.writer.addInt32(5);
    this.writer.add(Buffer.from(salt));

    const response = this.writer.flush(
      BackendMessageCode.AuthenticationResponse,
    );

    this.sendData(response);
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
    this.writer.addString('S');
    this.writer.addCString(error.severity);

    this.writer.addString('V');
    this.writer.addCString(error.severity);

    this.writer.addString('C');
    this.writer.addCString(error.code);

    this.writer.addString('M');
    this.writer.addCString(error.message);

    if (error.detail !== undefined) {
      this.writer.addString('D');
      this.writer.addCString(error.detail);
    }

    if (error.hint !== undefined) {
      this.writer.addString('H');
      this.writer.addCString(error.hint);
    }

    if (error.position !== undefined) {
      this.writer.addString('P');
      this.writer.addCString(error.position);
    }

    if (error.internalPosition !== undefined) {
      this.writer.addString('p');
      this.writer.addCString(error.internalPosition);
    }

    if (error.internalQuery !== undefined) {
      this.writer.addString('q');
      this.writer.addCString(error.internalQuery);
    }

    if (error.where !== undefined) {
      this.writer.addString('W');
      this.writer.addCString(error.where);
    }

    if (error.schema !== undefined) {
      this.writer.addString('s');
      this.writer.addCString(error.schema);
    }

    if (error.table !== undefined) {
      this.writer.addString('t');
      this.writer.addCString(error.table);
    }

    if (error.column !== undefined) {
      this.writer.addString('c');
      this.writer.addCString(error.column);
    }

    if (error.dataType !== undefined) {
      this.writer.addString('d');
      this.writer.addCString(error.dataType);
    }

    if (error.constraint !== undefined) {
      this.writer.addString('n');
      this.writer.addCString(error.constraint);
    }

    if (error.file !== undefined) {
      this.writer.addString('F');
      this.writer.addCString(error.file);
    }

    if (error.line !== undefined) {
      this.writer.addString('L');
      this.writer.addCString(error.line);
    }

    if (error.routine !== undefined) {
      this.writer.addString('R');
      this.writer.addCString(error.routine);
    }

    // Add null byte to the end
    this.writer.addCString('');

    const response = this.writer.flush(BackendMessageCode.ErrorMessage);
    this.sendData(response);
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
