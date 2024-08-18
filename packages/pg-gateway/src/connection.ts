import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { BufferReader } from './buffer-reader.js';
import { BufferWriter } from './buffer-writer.js';

import type { AuthFlow } from './auth/base-auth-flow.js';
import { type AuthOptions, createAuthFlow } from './auth/index.js';
import {
  type BackendError,
  createBackendErrorMessage,
} from './backend-error.js';
import {
  type ClientInfo,
  type ConnectionState,
  ServerStep,
  type TlsInfo,
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
  serverVersion?:
    | string
    | ((state: ConnectionState) => string | Promise<string>);

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
   */
  onStartup?(state: ConnectionState): void | Promise<void>;

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
   */
  onQuery?(
    query: string,
    state: ConnectionState,
  ):
    | void
    | Promise<void>
    | null
    | Promise<null>
    | QueryResponse
    | Promise<QueryResponse>;
};

export type QueryResponse =
  | Iterable<CommandResponse>
  | AsyncIterable<CommandResponse>;

export type Command =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'merge'
  | 'move'
  | 'fetch'
  | 'copy';

export type ExecCommandResponse = {
  command: Command;
  affectedRows: number | (() => number);
};

export type QueryCommandResponse = {
  command: Command;
  fields: Field[];
  rows:
    | Iterable<Row>
    | AsyncIterable<Row>
    | (() => Iterable<Row>)
    | (() => AsyncIterable<Row>);
  affectedRows?: number | ((iteratedRows: number) => number);
};

export type CommandResponse = ExecCommandResponse | QueryCommandResponse | null;

export type Field<T extends string = string> = {
  name: T;
  dataType: {
    id: number;
    size?: number;
    modifier?: number;
  };
  format?: 'text' | 'binary';
  tableId?: number;
  columnId?: number;
};

// TODO: support non-string types
export type Row<T = Record<string, string>> = T;

export default class PostgresConnection {
  private step: ServerStep = ServerStep.AwaitingInitialMessage;
  options: PostgresConnectionOptions & {
    auth: NonNullable<PostgresConnectionOptions['auth']>;
  };
  authFlow?: AuthFlow;
  secureSocket?: TLSSocket;
  hasStarted = false;
  isAuthenticated = false;
  detached = false;
  writer = new BufferWriter();
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
      step: this.step,
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
    this.detached = true;
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

    // the socket was detached during onMessage, we skip further processing
    if (this.detached) {
      return;
    }

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
          // Guard against SSL connection not being established when `tls` is enabled
          if (this.options.tls && !this.secureSocket) {
            this.sendError({
              severity: 'FATAL',
              code: '08P01',
              message: 'SSL connection is required',
            });
            this.socket.end();
            return;
          }
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

    this.socket.pause();
    await this.options.onStartup?.(this.state);
    this.socket.resume();

    // the socket was detached during onStartup, we skip further processing
    if (this.detached) {
      return;
    }

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
      case FrontendMessageCode.Query:
        this.handleQuery(message);
        break;
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

  async handleQuery(message: Buffer) {
    const length = this.reader.int32();
    const query = this.reader.cstring();

    if (!this.options.onQuery) {
      return;
    }

    this.socket.pause();
    const queryResponse = await this.options.onQuery(query, this.state);
    this.socket.resume();

    if (!queryResponse) {
      if (queryResponse === null) {
        this.sendEmptyQueryResponse();
        this.sendReadyForQuery();
      }
      return;
    }

    for await (const commandResponse of queryResponse) {
      if (commandResponse === null) {
        this.sendEmptyQueryResponse();
        this.sendReadyForQuery();
        return;
      }

      if ('fields' in commandResponse && 'rows' in commandResponse) {
        const { command, fields, rows, affectedRows } = commandResponse;

        const iterableRows = typeof rows === 'function' ? rows() : rows;

        this.sendRowDescription(fields);

        let iteratedRows = 0;
        for await (const row of iterableRows) {
          this.sendDataRow(row, fields);
          iteratedRows++;
        }

        const finalAffectedRows =
          typeof affectedRows === 'function'
            ? affectedRows(iteratedRows)
            : affectedRows ?? iteratedRows;

        this.sendCommandComplete(command, finalAffectedRows);
      } else {
        const { command, affectedRows } = commandResponse;

        const finalAffectedRows =
          typeof affectedRows === 'function' ? affectedRows() : affectedRows;

        this.sendCommandComplete(command, finalAffectedRows);
      }
    }

    this.sendReadyForQuery();
  }

  sendRowDescription(fields: Field[]) {
    console.log({ fields });
    this.writer.addInt16(fields.length);

    for (const field of fields) {
      this.writer.addCString(field.name);
      this.writer.addInt32(field.tableId ?? 0);
      this.writer.addInt16(field.columnId ?? 0);
      this.writer.addInt32(field.dataType.id);
      this.writer.addInt16(field.dataType.size ?? -1);
      this.writer.addInt32(field.dataType.modifier ?? -1);
      switch (field.format) {
        case undefined:
        case 'text':
          this.writer.addInt16(0);
          break;
        case 'binary':
          this.writer.addInt16(1);
          break;
        default:
          throw new Error(`Unknown field format '${field.format}'`);
      }
    }

    const response = this.writer.flush(
      BackendMessageCode.RowDescriptionMessage,
    );
    this.sendData(response);
  }

  sendDataRow(row: Row, fields: Field[]) {
    const columns = Object.entries(row)
      .map(([key, value]) => {
        const fieldIndex = fields.findIndex((field) => field.name === key);

        const field = fields[fieldIndex];

        if (!field) {
          throw new Error(
            `Row column '${key}' does not exists in fields array`,
          );
        }

        return {
          field,
          fieldIndex,
          value,
        };
      })
      .sort((columnA, columnB) => columnA.fieldIndex - columnB.fieldIndex);

    this.writer.addInt16(columns.length);

    for (const { field, value } of columns) {
      this.writer.addInt32(value.length);

      switch (field.format) {
        case undefined:
        case 'text':
          // TODO: serialize non-text types to their appropriate string value
          this.writer.addString(value);
          break;

        case 'binary':
          // TODO: serialize non-text types to their appropriate binary value
          this.writer.add(Buffer.from(value));
          break;
        default:
          throw new Error(`Unknown field format '${field.format}'`);
      }
    }

    const response = this.writer.flush(BackendMessageCode.DataRow);
    this.sendData(response);
  }

  /**
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COMMANDCOMPLETE
   */
  sendCommandComplete(command: Command, affectedRows: number) {
    // Insert is a special case, see linked spec above
    if (command === 'insert') {
      this.writer.addCString(`${command.toUpperCase()} 0 ${affectedRows}`);
    } else {
      this.writer.addCString(`${command.toUpperCase()} ${affectedRows}`);
    }
    const response = this.writer.flush(BackendMessageCode.CommandComplete);
    this.sendData(response);
  }

  /**
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-EMPTYQUERYRESPONSE
   */
  sendEmptyQueryResponse() {
    const response = this.writer.flush(BackendMessageCode.EmptyQuery);
    this.sendData(response);
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

    this.socket.pause();
    await this.options.onAuthenticated?.(this.state);
    this.socket.resume();

    if (this.options.serverVersion) {
      let serverVersion: string;
      if (typeof this.options.serverVersion === 'function') {
        this.socket.pause();
        serverVersion = await this.options.serverVersion(this.state);
        this.socket.resume();
      } else {
        serverVersion = this.options.serverVersion;
      }
      this.sendParameterStatus('server_version', serverVersion);
    }

    this.step = ServerStep.ReadyForQuery;
    this.sendReadyForQuery('idle');
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
