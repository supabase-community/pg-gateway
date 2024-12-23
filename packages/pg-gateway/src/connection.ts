import type { AuthFlow } from './auth/base-auth-flow.js';
import { type AuthOptions, createAuthFlow } from './auth/index.js';
import { BackendError } from './backend-error.js';
import { BufferReader } from './buffer-reader.js';
import { BufferWriter } from './buffer-writer.js';
import {
  type ClientParameters,
  type ConnectionState,
  ServerStep,
  type TlsInfo,
} from './connection.types.js';
import { AsyncIterableWithMetadata } from './iterable-util.js';
import { MessageBuffer } from './message-buffer.js';
import { BackendMessageCode, FrontendMessageCode } from './message-codes.js';
import { type ConnectionSignal, closeSignal, tlsUpgradeSignal } from './signals.js';
import { type DuplexStream, toAsyncIterator } from './streams.js';

export type TlsOptions = {
  key: ArrayBuffer;
  cert: ArrayBuffer;
  ca?: ArrayBuffer;
  passphrase?: string;
};

export type TlsOptionsCallback = (serverName?: string) => TlsOptions | Promise<TlsOptions>;

export type PostgresConnectionOptions = {
  /**
   * The server version to send to the frontend.
   */
  serverVersion?: string | ((state: ConnectionState) => string | Promise<string>);

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
   * Callback can optionally return raw `Uint8Array` response data that will
   * be sent back to the client. It can also return multiple `Uint8Array`
   * responses via an `Iterable<Uint8Array>` or `AsyncIterable<Uint8Array>`.
   * This means you can turn this hook into a generator function to
   * asynchronously stream responses back to the client.
   *
   * **Warning:** By managing the message yourself (returning data), you bypass further
   * processing by the `PostgresConnection` which means some state may not be collected
   * and hooks won't be called depending on where the protocol is at in its lifecycle.
   * If you wish to hook into messages without bypassing further processing, do not return
   * any data from this callback.
   */
  onMessage?(data: Uint8Array, state: ConnectionState): MessageResponse | Promise<MessageResponse>;

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
  onQuery?(query: string, state: ConnectionState): Uint8Array | Promise<Uint8Array>;
};

/**
 * Platform-specific adapters for handling features like TLS upgrades.
 *
 * Some platform helpers like `fromNodeSocket()` will implement these
 * for you.
 */
export type PostgresConnectionAdapters = {
  /**
   * Implements the TLS upgrade logic for the stream.
   */
  upgradeTls?(
    duplex: DuplexStream<Uint8Array>,
    options: TlsOptions | TlsOptionsCallback,
    requestCert?: boolean,
  ): Promise<{
    duplex: DuplexStream<Uint8Array>;
    tlsInfo: TlsInfo;
  }>;
};

export type MessageResponse =
  | undefined
  | Uint8Array
  | Iterable<Uint8Array>
  | AsyncIterable<Uint8Array>;

export default class PostgresConnection {
  private step: ServerStep = ServerStep.AwaitingInitialMessage;
  options: PostgresConnectionOptions & {
    auth: NonNullable<PostgresConnectionOptions['auth']>;
  };
  authFlow?: AuthFlow;
  hasStarted = false;
  isAuthenticated = false;
  detached = false;
  bufferWriter = new BufferWriter();
  bufferReader = new BufferReader();
  clientParams?: ClientParameters;
  tlsInfo?: TlsInfo;
  messageBuffer = new MessageBuffer();
  // reference to the stream writer when processing data
  streamWriter?: WritableStreamDefaultWriter<Uint8Array>;

  constructor(
    public duplex: DuplexStream<Uint8Array>,
    options: PostgresConnectionOptions = {},
    public adapters: PostgresConnectionAdapters = {},
  ) {
    this.options = {
      auth: { method: 'trust' },
      ...options,
    };
    if (this.options.tls && !this.adapters.upgradeTls) {
      throw new Error(
        'TLS options are only available when upgradeTls() is implemented. Did you mean to use fromNodeSocket()?',
      );
    }
    this.init(duplex);
  }

  get state(): ConnectionState {
    return {
      hasStarted: this.hasStarted,
      isAuthenticated: this.isAuthenticated,
      clientParams: this.clientParams,
      tlsInfo: this.tlsInfo,
      step: this.step,
    };
  }

  async init(duplex: DuplexStream<Uint8Array>) {
    try {
      const signal = await this.processData(duplex);

      if (this.detached) {
        return;
      }

      if (signal === tlsUpgradeSignal) {
        if (!this.options.tls) {
          throw new Error('Upgrading TLS but TLS options are not available');
        }
        if (!this.adapters.upgradeTls) {
          throw new Error('Upgrading TLS but upgradeTls is not implemented');
        }

        const requestCert = this.options.auth.method === 'cert';

        const { duplex: secureDuplex, tlsInfo } = await this.adapters.upgradeTls(
          duplex,
          this.options.tls,
          requestCert,
        );

        this.duplex = secureDuplex;
        this.tlsInfo = tlsInfo;
        this.messageBuffer = new MessageBuffer();

        await this.options.onTlsUpgrade?.(this.state);

        if (this.detached) {
          return;
        }

        await this.init(secureDuplex);
        return;
      }

      if (signal === closeSignal) {
        await this.duplex.writable.close();
        return;
      }
    } catch (err) {
      if (err instanceof BackendError) {
        const writer = this.duplex.writable.getWriter();
        await writer.write(err.flush());
        writer.releaseLock();
        await this.duplex.writable.close();
      } else {
        // ignore ABORT_ERR errors which are common, like a user closing its terminal while running a psql session
        if (!(err instanceof Error && 'code' in err && err.code === 'ABORT_ERR')) {
          console.error(err);
        }
        await this.duplex.writable.abort();
      }
    }
  }
  /**
   * Detaches the `PostgresConnection` from the stream.
   * After calling this, data will no longer be buffered
   * and all processing will halt.
   *
   * Useful when proxying. You can detach at a certain point
   * (like TLS upgrade) to prevent further buffering/processing
   * when your goal is to pipe future messages downstream.
   */
  async detach() {
    this.detached = true;

    // TODO: inject lingering `messageBuffer` (if any) back
    // onto stream to prevent data loss
    return this.duplex;
  }

  async processData(duplex: DuplexStream<Uint8Array>): Promise<ConnectionSignal | undefined> {
    this.streamWriter = duplex.writable.getWriter();
    try {
      for await (const data of toAsyncIterator(duplex.readable, { preventCancel: true })) {
        this.messageBuffer.mergeBuffer(data);
        for await (const clientMessage of this.messageBuffer.processMessages(this.hasStarted)) {
          for await (const responseMessage of this.handleClientMessage(clientMessage)) {
            if (this.detached) {
              return;
            }
            if (responseMessage === tlsUpgradeSignal) {
              return tlsUpgradeSignal;
            }
            if (responseMessage === closeSignal) {
              return closeSignal;
            }
            await this.streamWriter.write(responseMessage);
          }
        }
      }
    } finally {
      this.streamWriter.releaseLock();
    }
  }

  async *handleClientMessage(
    message: Uint8Array,
  ): AsyncGenerator<Uint8Array | ConnectionSignal, void, undefined> {
    this.bufferReader.setBuffer(message);

    const messageResponse = await this.options.onMessage?.(message, this.state);

    // Returning any value indicates no further processing
    let skipProcessing = messageResponse !== undefined;

    // A `Uint8Array` or `Iterator<Uint8Array>` or `AsyncIterator<Uint8Array>`
    // can be returned that contains raw message response data
    if (messageResponse) {
      const iterableResponse = new AsyncIterableWithMetadata(
        messageResponse instanceof Uint8Array ? [messageResponse] : messageResponse,
      );

      // Forward yielded responses back to client
      yield* iterableResponse;

      // Yield any `Uint8Array` values returned from the iterator
      if (iterableResponse.returnValue instanceof Uint8Array) {
        yield iterableResponse.returnValue;
      }

      // Yielding or returning any value within the iterator indicates no further processing
      skipProcessing =
        iterableResponse.iterations > 0 || iterableResponse.returnValue !== undefined;
    }

    // the socket was detached during onMessage, we skip further processing
    if (this.detached) {
      return;
    }

    if (skipProcessing) {
      if (this.isStartupMessage(message)) {
        this.hasStarted = true;
      }
      return;
    }

    switch (this.step) {
      case ServerStep.AwaitingInitialMessage:
        if (this.isSslRequest(message)) {
          yield* this.handleSslRequest();
        } else if (this.isStartupMessage(message)) {
          // Guard against SSL connection not being established when `tls` is enabled
          if (this.options.tls && !this.tlsInfo) {
            yield BackendError.create({
              severity: 'FATAL',
              code: '08P01',
              message: 'SSL connection is required',
            }).flush();
            yield closeSignal;
            return;
          }
          // the next step is determined by handleStartupMessage
          yield* this.handleStartupMessage(message);
        } else {
          throw new Error('Unexpected initial message');
        }
        break;

      case ServerStep.PerformingAuthentication: {
        const authenticationComplete = yield* this.handleAuthenticationMessage(message);
        if (authenticationComplete) {
          yield* this.completeAuthentication();
        }
        break;
      }

      case ServerStep.ReadyForQuery:
        yield* this.handleRegularMessage(message);
        break;

      default:
        throw new Error(`Unexpected step: ${this.step}`);
    }
  }

  async *handleSslRequest() {
    if (!this.options.tls || !this.adapters.upgradeTls) {
      this.bufferWriter.addString('N');
      yield this.bufferWriter.flush();
      return;
    }

    // Otherwise respond with 'S' to indicate it is supported
    this.bufferWriter.addString('S');
    yield this.bufferWriter.flush();

    // From now on the frontend will communicate via TLS, so upgrade the connection
    yield tlsUpgradeSignal;
  }

  async *handleStartupMessage(message: BufferSource) {
    const { majorVersion, minorVersion, parameters } = this.readStartupMessage();

    // user is required
    if (!parameters.user) {
      yield BackendError.create({
        severity: 'FATAL',
        code: '08000',
        message: 'user is required',
      }).flush();
      yield closeSignal;
      return;
    }

    if (majorVersion !== 3 || minorVersion !== 0) {
      yield BackendError.create({
        severity: 'FATAL',
        code: '08000',
        message: `Unsupported protocol version ${majorVersion.toString()}.${minorVersion.toString()}`,
      }).flush();
      yield closeSignal;
      return;
    }

    this.clientParams = {
      user: parameters.user,
      ...parameters,
    };

    this.hasStarted = true;

    await this.options.onStartup?.(this.state);
    // the socket was detached during onStartup, we skip further processing
    if (this.detached) {
      return;
    }

    if (this.options.auth.method === 'trust') {
      yield* this.completeAuthentication();
      return;
    }

    this.authFlow = createAuthFlow({
      reader: this.bufferReader,
      writer: this.bufferWriter,
      username: this.clientParams.user,
      auth: this.options.auth,
      connectionState: this.state,
    });

    this.step = ServerStep.PerformingAuthentication;
    const initialAuthMessage = this.authFlow.createInitialAuthMessage();

    if (initialAuthMessage) {
      yield initialAuthMessage;
    }

    // 'cert' auth flow is an edge case
    // it doesn't expect a new message from the client so we can directly proceed
    if (this.options.auth.method === 'cert') {
      yield* this.authFlow.handleClientMessage(message);
      if (this.authFlow.isCompleted) {
        yield* this.completeAuthentication();
      }
    }
  }

  async *handleAuthenticationMessage(message: BufferSource) {
    const code = this.bufferReader.byte();

    if (code !== FrontendMessageCode.Password) {
      throw new Error(`Unexpected authentication message code: ${code}`);
    }

    if (!this.authFlow) {
      throw new Error('AuthFlow not initialized');
    }

    yield* this.authFlow.handleClientMessage(message);

    return this.authFlow.isCompleted;
  }

  private async *handleRegularMessage(message: BufferSource) {
    const code = this.bufferReader.byte();

    switch (code) {
      case FrontendMessageCode.Terminate:
        yield closeSignal;
        return;
      default:
        yield BackendError.create({
          severity: 'ERROR',
          code: '123',
          message: 'Message code not yet implemented',
        }).flush();
        yield this.createReadyForQuery();
    }
  }

  /**
   * Checks if the given message is a valid SSL request.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-SSLREQUEST
   */
  private isSslRequest(message: Uint8Array): boolean {
    if (message.byteLength !== 8) return false;

    const dataView = new DataView(message.buffer, message.byteOffset, message.byteLength);

    const mostSignificantPart = dataView.getInt16(4);
    const leastSignificantPart = dataView.getInt16(6);

    return mostSignificantPart === 1234 && leastSignificantPart === 5679;
  }

  /**
   * Checks if the given message is a valid StartupMessage.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-STARTUPMESSAGE
   */
  private isStartupMessage(message: Uint8Array): boolean {
    if (message.byteLength < 8) return false;

    const dataView = new DataView(message.buffer, message.byteOffset, message.byteLength);

    const length = dataView.getInt32(0);
    const majorVersion = dataView.getInt16(4);
    const minorVersion = dataView.getInt16(6);

    return message.byteLength === length && majorVersion === 3 && minorVersion === 0;
  }

  /**
   * Completes authentication by forwarding the appropriate messages
   * to the frontend.
   */
  async *completeAuthentication() {
    this.isAuthenticated = true;

    yield this.createAuthenticationOk();

    await this.options.onAuthenticated?.(this.state);

    if (this.options.serverVersion) {
      let serverVersion: string;
      if (typeof this.options.serverVersion === 'function') {
        serverVersion = await this.options.serverVersion(this.state);
      } else {
        serverVersion = this.options.serverVersion;
      }
      yield this.createParameterStatus('server_version', serverVersion);
    }

    this.step = ServerStep.ReadyForQuery;
    yield this.createReadyForQuery();
  }

  /**
   * Parses a startup message from the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-STARTUPMESSAGE
   */
  readStartupMessage() {
    const length = this.bufferReader.int32();
    const majorVersion = this.bufferReader.int16();
    const minorVersion = this.bufferReader.int16();

    const parameters: Record<string, string> = {};

    // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
    for (let key: string; (key = this.bufferReader.cstring()) !== ''; ) {
      parameters[key] = this.bufferReader.cstring();
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
    const query = this.bufferReader.cstring();

    return {
      query,
    };
  }

  /**
   * Creates an "AuthenticationOk" message.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONOK
   */
  createAuthenticationOk() {
    this.bufferWriter.addInt32(0);
    return this.bufferWriter.flush(BackendMessageCode.AuthenticationResponse);
  }

  /**
   * Creates a "ParameterStatus" message.
   * Informs the frontend about the current setting of backend parameters.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARAMETERSTATUS
   * @see https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-ASYNC
   */
  createParameterStatus(name: string, value: string) {
    this.bufferWriter.addCString(name);
    this.bufferWriter.addCString(value);
    return this.bufferWriter.flush(BackendMessageCode.ParameterStatus);
  }

  /**
   * Creates a "ReadyForQuery" message.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-READYFORQUERY
   */
  createReadyForQuery(transactionStatus: 'idle' | 'transaction' | 'error' = 'idle') {
    switch (transactionStatus) {
      case 'idle':
        this.bufferWriter.addString('I');
        break;
      case 'transaction':
        this.bufferWriter.addString('T');
        break;
      case 'error':
        this.bufferWriter.addString('E');
        break;
      default:
        throw new Error(`Unknown transaction status '${transactionStatus}'`);
    }

    return this.bufferWriter.flush(BackendMessageCode.ReadyForQuery);
  }

  createAuthenticationFailedError() {
    return BackendError.create({
      severity: 'FATAL',
      code: '28P01',
      message: this.clientParams?.user
        ? `password authentication failed for user "${this.clientParams.user}"`
        : 'password authentication failed',
    }).flush();
  }
}
