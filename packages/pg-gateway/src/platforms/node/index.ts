import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import PostgresConnection, {
  type PostgresConnectionAdapters,
  type PostgresConnectionOptions,
} from '../../connection.js';
import { upgradeTls, validateCredentials } from './tls.js';
import type { DuplexStream } from '../../streams.js';

/**
 * Creates a `PostgresConnection` from a Node.js TCP/Unix `Socket`.
 *
 * `PostgresConnection` operates on web streams, so this helper
 * converts a `Socket` to/from the respective web streams.
 *
 * Also implements `upgradeTls()`, which makes Postgres `SSLRequest`
 * upgrades available in Node.js environments.
 */
export async function fromNodeSocket(socket: Socket, options?: PostgresConnectionOptions) {
  return fromDuplexStream(Duplex.toWeb(socket), options);
}

/**
 * Creates a `PostgresConnection` from a `DuplexStream` with
 * Node.js adapters like `upgradeTls()` included.
 *
 * Useful in Node.js environments when you start from a
 * non-Socket stream but want Node.js TLS adapters.
 */
export async function fromDuplexStream(
  duplex: DuplexStream<Uint8Array>,
  options?: PostgresConnectionOptions,
) {
  const opts: PostgresConnectionOptions = {
    ...options,
  };

  if (opts?.auth?.method === 'cert') {
    opts.auth.validateCredentials = validateCredentials;
  }

  const adapters: PostgresConnectionAdapters = {
    upgradeTls,
  };

  return new PostgresConnection(duplex, options, adapters);
}
