import { PostgresConnection, createDuplexPair, createScramSha256Data } from 'pg-gateway';
import { serialize } from 'pg-protocol';
import type { BackendMessage } from 'pg-protocol/dist/messages';
import { Parser } from 'pg-protocol/dist/parser';
import { type Session, continueSession, finalizeSession, startSession } from 'pg/lib/crypto/sasl';
import { it } from 'vitest';

/**
 * Creates a one-time `PostgresConnection` and links to an
 * in-memory client `DuplexStream`.
 */
function connect() {
  const [clientDuplex, serverDuplex] = createDuplexPair<Uint8Array>();

  new PostgresConnection(serverDuplex, {
    auth: {
      method: 'scram-sha-256',
      async getScramSha256Data() {
        return await createScramSha256Data('postgres');
      },
    },
  });

  return clientDuplex;
}

it('completes sasl handshake', async () => {
  const { readable, writable } = connect();

  // Transforms `Buffer` to `Uint8Array`
  const bufferTransform = new TransformStream<Buffer, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(new Uint8Array(chunk));
    },
  });

  bufferTransform.readable.pipeTo(writable);
  const writer = bufferTransform.writable.getWriter();

  const user = 'postgres';
  const password = 'postgres';

  await writer.write(serialize.startup({ user }));

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
