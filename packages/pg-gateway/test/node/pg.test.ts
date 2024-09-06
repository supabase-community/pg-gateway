import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { PostgresConnection, createDuplexPair } from 'pg-gateway';
import { describe, expect, it } from 'vitest';
import { PGliteExtendedQueryPatch, socketFromDuplexStream } from '../util.js';

const { Client } = pg;

/**
 * Creates a one-time `PostgresConnection` and links to a
 * `pg` client via in-memory duplex streams.
 */
async function connect() {
  const [clientDuplex, serverDuplex] = createDuplexPair<Uint8Array>();

  const db = new PGlite();

  const connection = new PostgresConnection(serverDuplex, {
    async onStartup() {
      await db.waitReady;
    },
    async onMessage(data, { isAuthenticated }) {
      if (!isAuthenticated) {
        return;
      }
      // Send message to PGlite
      const response = await db.execProtocolRaw(data);
      return extendedQueryPatch.filterResponse(data, response);
    },
  });

  const extendedQueryPatch = new PGliteExtendedQueryPatch(connection);

  const client = new Client({
    user: 'postgres',
    stream: socketFromDuplexStream(clientDuplex),
  });
  await client.connect();

  return client;
}

describe('pg client with pglite', () => {
  it('simple query returns result', async () => {
    const client = await connect();
    const res = await client.query("select 'Hello world!' as message");
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
    await client.end();
  });

  it('extended query returns result', async () => {
    const client = await connect();
    const res = await client.query('SELECT $1::text as message', ['Hello world!']);
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
    await client.end();
  });
});
