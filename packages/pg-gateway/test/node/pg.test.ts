import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { PostgresConnection, createDuplexPair } from 'pg-gateway';
import { socketFromDuplexStream } from '@nodeweb/pg/socket';
import { describe, expect, it } from 'vitest';

const { Client } = pg;

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
});
