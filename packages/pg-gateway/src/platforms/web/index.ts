import PostgresConnection, { type PostgresConnectionOptions } from '../../connection.js';
import type { Duplex } from '../../duplex.js';

/**
 * Creates a `PostgresConnection` from a `WebSocketStream`.
 *
 * Note Postgres `SSLRequest` upgrades are not supported in a `WebSocketStream`.
 */
export async function fromWebSocketStream(
  wss: WebSocketStream,
  options?: PostgresConnectionOptions,
) {
  const duplex = await webSocketStreamToDuplex(wss);
  return new PostgresConnection(duplex, options);
}

/**
 * Creates a `Duplex` binary web stream from a `WebSocketStream`.
 */
export async function webSocketStreamToDuplex(wss: WebSocketStream): Promise<Duplex<Uint8Array>> {
  const { readable, writable } = await wss.opened;

  return {
    readable: ensureBinaryStream(
      readable,
      new Error('WebSocketStream must contain binary data for a PostgresConnection, found text'),
    ),
    writable,
  };
}

/**
 * Ensures that a `ReadableStream` contains binary data and not text.
 */
function ensureBinaryStream(readable: ReadableStream<string | Uint8Array>, error: Error) {
  return ReadableStream.from(ensureBinaryIterable(readable, error));
}

/**
 * Ensures that an `AsyncIterable` contains binary data and not text.
 */
async function* ensureBinaryIterable(iterable: AsyncIterable<string | Uint8Array>, error: Error) {
  for await (const chunk of iterable) {
    if (typeof chunk === 'string') {
      throw error;
    }
    yield chunk;
  }
}