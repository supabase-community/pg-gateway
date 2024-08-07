import type { Socket } from 'node:net';
import type { BufferReader } from 'pg-protocol/dist/buffer-reader';
import type { Writer } from 'pg-protocol/dist/buffer-writer';
import { BackendMessageCode } from '../connection';
import { sendError } from '../util';
import { type ScramSha256Data, ScramSha256Flow } from './scram-sha-256';

const SaslMessageCode = {
  AuthenticationSASL: 10,
  AuthenticationSASLContinue: 11,
  AuthenticationSASLFinal: 12,
} as const;

export class SaslAuthFlow {
  socket: Socket;
  reader: BufferReader;
  writer: Writer;
  username: string;
  getData: (params: {
    username: string;
  }) => ScramSha256Data | Promise<ScramSha256Data>;
  validateCredentials?: (params: {
    authMessage: string;
    clientProof: string;
    username: string;
    scramSha256Data: ScramSha256Data;
  }) => boolean | Promise<boolean>;
  scramSha256Flow?: ScramSha256Flow;
  constructor(params: {
    socket: Socket;
    reader: BufferReader;
    writer: Writer;
    username: string;
    getData: (params: {
      username: string;
    }) => ScramSha256Data | Promise<ScramSha256Data>;
    validateCredentials?: (params: {
      authMessage: string;
      clientProof: string;
      username: string;
      scramSha256Data: ScramSha256Data;
    }) => boolean | Promise<boolean>;
  }) {
    this.socket = params.socket;
    this.reader = params.reader;
    this.writer = params.writer;
    this.username = params.username;
    this.getData = params.getData;
  }

  sendAuthenticationSASL() {
    const mechanisms = ['SCRAM-SHA-256'];
    this.writer.addInt32(SaslMessageCode.AuthenticationSASL);
    for (const mechanism of mechanisms) {
      this.writer.addCString(mechanism);
    }
    this.writer.addCString('');
    const response = this.writer.flush(
      BackendMessageCode.AuthenticationResponse,
    );
    this.socket.write(response);
  }

  async handleAuthenticationSASLResponse() {
    const saslMechanism = this.reader.cstring();

    switch (saslMechanism) {
      case 'SCRAM-SHA-256': {
        const responseLength = this.reader.int32();
        const clientFirstMessage = this.reader.string(responseLength);

        this.scramSha256Flow = new ScramSha256Flow({
          getData: this.getData,
          username: this.username,
          validateCredentials: this.validateCredentials,
        });

        const serverFirstMessage =
          await this.scramSha256Flow.createServerFirstMessage(
            clientFirstMessage,
          );

        this.sendAuthenticationSASLContinue(serverFirstMessage);
        return;
      }
      default:
        this.sendError({
          severity: 'FATAL',
          code: '28000',
          message: 'Unsupported SASL authentication mechanism',
        });
        this.socket.end();
        return;
    }
  }

  async handleAuthenticationSASLContinueResponse() {}

  sendAuthenticationSASLContinue(message: string) {
    this.writer.addInt32(SaslMessageCode.AuthenticationSASLContinue);
    this.writer.addString(message);
    const response = this.writer.flush(
      BackendMessageCode.AuthenticationResponse,
    );
    this.socket.write(response);
  }

  sendAuthenticationSASLFinal(message: string) {
    this.writer.addInt32(SaslMessageCode.AuthenticationSASLFinal);
    this.writer.addString(message);
    const response = this.writer.flush(
      BackendMessageCode.AuthenticationResponse,
    );
    this.socket.write(response);
  }

  sendError = sendError.bind(this);
}
