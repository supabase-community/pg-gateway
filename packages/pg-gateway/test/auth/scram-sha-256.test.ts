import { PGlite } from '@electric-sql/pglite';
import net, { Socket } from 'node:net';
import { createScramSha256Data } from 'pg-gateway';
import { fromNodeSocket, webDuplexFromNodeDuplex } from 'pg-gateway/node';
import { serialize } from 'pg-protocol';
import type { BackendMessage } from 'pg-protocol/dist/messages';
import { Parser } from 'pg-protocol/dist/parser';
import { type Session, continueSession, finalizeSession, startSession } from 'pg/lib/crypto/sasl';
import { afterAll, beforeAll, it } from 'vitest';

let server: net.Server;

beforeAll(() => {
  server = net.createServer(async (socket) => {
    const db = new PGlite();

    await fromNodeSocket(socket, {
      auth: {
        method: 'scram-sha-256',
        async getScramSha256Data() {
          return await createScramSha256Data('postgres');
        },
      },
      async onStartup() {
        await db.waitReady;
      },
      async onMessage(data, { isAuthenticated }) {
        if (!isAuthenticated) {
          return;
        }
        return await db.execProtocolRaw(data);
      },
    });
  });

  server.listen(54329);
});

afterAll(() => {
  server.close();
});

it('completes sasl handshake', async () => {
  const client = new Socket();

  try {
    client.connect(54329);

    const { readable, writable } = await webDuplexFromNodeDuplex(client);
    const writer = writable.getWriter();

    const user = 'postgres';
    const password = 'postgres';

    writer.write(serialize.startup({ user }));

    let saslSession: Session | undefined;

    for await (const message of parseMessages(readable)) {
      switch (message.name) {
        case 'error': {
          throw message;
        }
        case 'authenticationSASL': {
          // biome-ignore lint/suspicious/noExplicitAny: <explanation>
          const { mechanisms }: { mechanisms: string[] } = message as any;
          saslSession = startSession(mechanisms);
          const data = serialize.sendSASLInitialResponseMessage(
            saslSession.mechanism,
            saslSession.response,
          );
          writer.write(data);
          break;
        }
        case 'authenticationSASLContinue': {
          if (!saslSession) {
            throw new Error(`Received ${message.name} message before saslSession was initialized`);
          }

          // biome-ignore lint/suspicious/noExplicitAny: <explanation>
          const { data }: { data: string } = message as any;
          await continueSession(saslSession, password, data);
          const responseData = serialize.sendSCRAMClientFinalMessage(saslSession.response);
          writer.write(responseData);
          break;
        }
        case 'authenticationSASLFinal': {
          if (!saslSession) {
            throw new Error(`Received ${message.name} message before saslSession was initialized`);
          }

          // biome-ignore lint/suspicious/noExplicitAny: <explanation>
          const { data }: { data: string } = message as any;
          finalizeSession(saslSession, data);
          break;
        }
        case 'authenticationOk': {
          return;
        }
      }
    }
  } finally {
    client.end();
  }
});

async function* parseMessages(readable: ReadableStream) {
  const parser = new Parser();

  for await (const data of readable) {
    const messages: BackendMessage[] = [];

    parser.parse(Buffer.from(data), (message) => {
      messages.push(message);
    });

    yield* messages;
  }
}
