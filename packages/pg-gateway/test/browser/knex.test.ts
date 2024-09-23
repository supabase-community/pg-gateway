import { PGlite } from '@electric-sql/pglite';
import { PostgresConnection, createDuplexPair } from 'pg-gateway';
import Knex from '@nodeweb/knex';
import { config } from '@nodeweb/knex/config';
import pg from '@nodeweb/pg';
import { socketFromDuplexStream } from '@nodeweb/pg/socket';
import { describe, expect, it } from 'vitest';

config({
  drivers: {
    pg,
  },
});

/**
 * Creates a one-time `PostgresConnection` and links to a
 * `knex` client via in-memory duplex streams.
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

  const knex = Knex({
    client: 'pg',
    connection: {
      user: 'postgres',
      stream: socketFromDuplexStream(clientDuplex),
    },
  });

  return knex;
}

describe('knex client with pglite', () => {
  it('simple query returns result', async () => {
    const knex = await connect();
    const res = await knex.raw("select 'Hello world!' as message");
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
    await knex.destroy();
  });
});
