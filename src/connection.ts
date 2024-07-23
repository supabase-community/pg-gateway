import { Socket } from 'node:net';
import { BufferReader } from 'pg-protocol/dist/buffer-reader';
import { Writer } from 'pg-protocol/dist/buffer-writer';
import { generateMd5Salt } from './util.js';

export const enum FrontendMessageCode {
  Query = 0x51, // Q
  Parse = 0x50, // P
  Bind = 0x42, // B
  Execute = 0x45, // E
  FunctionCall = 0x46, // F
  Flush = 0x48, // H
  Close = 0x43, // C
  Describe = 0x44, // D
  CopyFromChunk = 0x64, // d
  CopyDone = 0x63, // c
  CopyData = 0x64, // d
  CopyFail = 0x66, // f
  Password = 0x70, // p
  Sync = 0x53, // S
  Terminate = 0x58, // X
}

export const enum BackendMessageCode {
  DataRow = 0x44, // D
  ParseComplete = 0x31, // 1
  BindComplete = 0x32, // 2
  CloseComplete = 0x33, // 3
  CommandComplete = 0x43, // C
  ReadyForQuery = 0x5a, // Z
  NoData = 0x6e, // n
  NotificationResponse = 0x41, // A
  AuthenticationResponse = 0x52, // R
  ParameterStatus = 0x53, // S
  BackendKeyData = 0x4b, // K
  ErrorMessage = 0x45, // E
  NoticeMessage = 0x4e, // N
  RowDescriptionMessage = 0x54, // T
  ParameterDescriptionMessage = 0x74, // t
  PortalSuspended = 0x73, // s
  ReplicationStart = 0x57, // W
  EmptyQuery = 0x49, // I
  CopyIn = 0x47, // G
  CopyOut = 0x48, // H
  CopyDone = 0x63, // c
  CopyData = 0x64, // d
}

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

export type CleartextPasswordCredentials = {
  authMode: 'cleartextPassword';
  user: string;
  password: string;
};

export type Md5PasswordCredentials = {
  authMode: 'md5Password';
  user: string;
  hash: string;
  salt: Uint8Array;
};

export type Credentials = CleartextPasswordCredentials | Md5PasswordCredentials;

export type BackendOptions = {
  /**
   * The server version to send to the frontend.
   */
  serverVersion?: string;

  /**
   * The authentication mode for the server.
   */
  authMode?: 'none' | 'cleartextPassword' | 'md5Password';

  /**
   * Validates `user` and `password` for connecting clients.
   * Callback should return `true` if credentials are valid and
   * `false` if credentials are invalid.
   */
  validateCredentials?(credentials: Credentials): boolean | Promise<boolean>;

  /**
   * Callback for every frontend message sent after startup.
   * Use this as an escape hatch to manually handle raw message data.
   *
   * Callback should return `true` to indicate that it has handled the message
   * and no further processing should occur. Return `false` to continue
   * built-in processing.
   */
  onMessage?(
    data: Uint8Array,
    state: {
      hasStarted: boolean;
      isAuthenticated: boolean;
    }
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
  onQuery?(query: string): Uint8Array | Promise<Uint8Array>;
};

export default class PostgresConnection {
  hasStarted = false;
  isAuthenticated = false;
  writer = new Writer();
  reader = new BufferReader();
  user?: string;
  md5Salt = generateMd5Salt();

  constructor(public socket: Socket, public options: BackendOptions = {}) {
    const { authMode = 'none' } = options;

    socket.on('data', async (data) => {
      this.reader.setBuffer(0, data);

      // If the `onMessage()` hook returns `true`, it managed this response, so return
      const skip = await options.onMessage?.(data, {
        hasStarted: this.hasStarted,
        isAuthenticated: this.isAuthenticated,
      });

      if (skip) {
        return;
      }

      if (!this.hasStarted) {
        const { majorVersion, minorVersion, parameters } =
          this.readStartupMessage();

        console.log('Client connection', {
          majorVersion,
          minorVersion,
          parameters,
        });

        // user is required
        if (!parameters.user) {
          this.sendError({
            severity: 'FATAL',
            code: '08000',
            message: `user is required`,
          });
          this.socket.end();
          return;
        }

        this.user = parameters.user;

        if (majorVersion !== 3 || minorVersion !== 0) {
          this.sendError({
            severity: 'FATAL',
            code: '08000',
            message: `Unsupported protocol version ${majorVersion.toString()}.${minorVersion.toString()}`,
          });
          this.socket.end();
          return;
        }

        // Handle authentication modes
        switch (authMode) {
          case 'none': {
            this.completeAuthentication();
            break;
          }
          case 'cleartextPassword': {
            this.sendAuthenticationCleartextPassword();
            break;
          }
          case 'md5Password': {
            this.sendAuthenticationMD5Password(this.md5Salt);
            break;
          }
        }

        this.hasStarted = true;
        return;
      }

      // Type narrowing for `this.user` - this condition should never happen
      if (!this.user) {
        this.sendError({
          severity: 'FATAL',
          code: 'XX000',
          message: `unknown user after startup`,
        });
        this.socket.end();
        return;
      }

      const code = this.reader.byte();
      const length = this.reader.int32();

      switch (code) {
        case FrontendMessageCode.Password: {
          switch (authMode) {
            case 'cleartextPassword': {
              const password = this.reader.cstring();
              const valid = await this.options.validateCredentials?.({
                authMode,
                user: this.user,
                password,
              });

              if (!valid) {
                this.sendAuthenticationFailedError();
                this.socket.end();
                return;
              }

              this.completeAuthentication();
              return;
            }
            case 'md5Password': {
              const hash = this.reader.cstring();
              const valid = await this.options.validateCredentials?.({
                authMode,
                user: this.user,
                hash,
                salt: this.md5Salt,
              });

              if (!valid) {
                this.sendAuthenticationFailedError();
                this.socket.end();
                return;
              }

              this.completeAuthentication();
              return;
            }
          }
          return;
        }
        case FrontendMessageCode.Query: {
          const query = this.reader.cstring();

          console.log(`Query: ${query}`);

          // TODO: call `onQuery` hook to allow consumer to choose how queries are implemented

          this.sendError({
            severity: 'ERROR',
            code: '123',
            message: 'Queries not yet implemented',
          });
          this.sendReadyForQuery('idle');
          return;
        }
      }
    });
  }

  /**
   * Completes authentication by forwarding the appropriate messages
   * to the frontend.
   */
  completeAuthentication() {
    this.isAuthenticated = true;
    this.sendAuthenticationOk();

    if (this.options.serverVersion) {
      this.sendParameterStatus('server_version', this.options.serverVersion);
    }

    this.sendReadyForQuery('idle');
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

    for (let key; (key = this.reader.cstring()) !== ''; ) {
      parameters[key] = this.reader.cstring();
    }

    return {
      majorVersion,
      minorVersion,
      parameters,
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
      BackendMessageCode.AuthenticationResponse
    );
    this.sendData(response);
  }

  /**
   * Sends an "AuthenticationMD5Password" message to the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONMD5PASSWORD
   */
  private sendAuthenticationMD5Password(salt: ArrayBuffer) {
    this.writer.addInt32(5);
    this.writer.add(Buffer.from(salt));

    const response = this.writer.flush(
      BackendMessageCode.AuthenticationResponse
    );

    this.sendData(response);
  }

  /**
   * Sends an "AuthenticationOk" message to the frontend.
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONOK
   */
  private sendAuthenticationOk() {
    this.writer.addInt32(0);
    const response = this.writer.flush(
      BackendMessageCode.AuthenticationResponse
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
  private sendParameterStatus(name: string, value: string) {
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
  private sendReadyForQuery(
    transactionStatus: 'idle' | 'transaction' | 'error'
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
      message: `password authentication failed for user "${this.user}"`,
    });
  }
}
