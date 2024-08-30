import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import PostgresConnection, { type PostgresConnectionOptions } from '../../connection.js';
import { upgradeTls } from './tls.js';

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
  const duplex = Duplex.toWeb(socket);
  const opts = options
    ? {
        upgradeTls,
        ...options,
      }
    : undefined;

  return new PostgresConnection(duplex, opts);
}
