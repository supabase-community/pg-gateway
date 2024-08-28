import type { Socket } from 'node:net';
import { PassThrough, Readable, Writable, type Duplex as NodeDuplex } from 'node:stream';
import PostgresConnection, { type PostgresConnectionOptions } from '../../connection.js';
import { upgradeTls } from './tls.js';
import type { Duplex } from '../../duplex.js';

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
  const duplex = await nodeDuplexToWebDuplex(socket);
  const opts = options
    ? {
        upgradeTls,
        ...options,
      }
    : undefined;

  return new PostgresConnection(duplex, opts);
}

/**
 * Creates a web stream `Duplex` from a Node.js `Duplex`.
 */
export async function nodeDuplexToWebDuplex(nodeDuplex: NodeDuplex): Promise<Duplex<Uint8Array>> {
  // Ensure the node duplex is not in flowing mode
  nodeDuplex.pause();

  return {
    readable: Readable.toWeb(nodeDuplex),
    writable: Writable.toWeb(nodeDuplex),
  };
}

/**
 * Creates a Node.js `Duplex` from a web stream `Duplex`.
 */
export async function webDuplexToNodeDuplex(duplex: Duplex<Uint8Array>): Promise<NodeDuplex> {
  const { readable, writable } = duplex;

  const nodeDuplex = new PassThrough();
  const nodeReadable = Readable.fromWeb(readable);
  const nodeWritable = Writable.fromWeb(writable);

  nodeReadable.pipe(nodeDuplex).pipe(nodeWritable);

  return nodeDuplex;
}
