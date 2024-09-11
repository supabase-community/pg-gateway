import { PGlite } from '@electric-sql/pglite';
import { PostgresConnection, createDuplexPair } from 'pg-gateway';
import { describe, expect, it } from 'vitest';
import { DisposablePgClient, socketFromDuplexStream } from '../util.js';

/**
 * Creates a one-time `PostgresConnection` and links to a
 * `pg` client via in-memory duplex streams.
 */
async function connect() {
  const [clientDuplex, serverDuplex] = createDuplexPair<Uint8Array>();

  const db = new PGlite();

  new PostgresConnection(serverDuplex, {
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

  const client = new DisposablePgClient({
    user: 'postgres',
    stream: socketFromDuplexStream(clientDuplex),
  });
  await client.connect();

  return client;
}

describe('pg client with pglite', () => {
  it('simple query returns result', async () => {
    await using client = await connect();
    const res = await client.query("select 'Hello world!' as message");
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
  });

  it('extended query returns result', async () => {
    await using client = await connect();
    const res = await client.query('SELECT $1::text as message', ['Hello world!']);
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
  });
});
