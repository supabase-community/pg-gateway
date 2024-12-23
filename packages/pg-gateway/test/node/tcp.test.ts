import { PGlite } from '@electric-sql/pglite';
import { once } from 'node:events';
import net from 'node:net';
import type { ClientConfig } from 'pg';
import { fromNodeSocket } from 'pg-gateway/node';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { DisposablePgClient } from '../util';

const port = 54320;
const connectionString = `postgresql://postgres:postgres@localhost:${port}/postgres`;

async function connectPg(config: string | ClientConfig = connectionString) {
  const client = new DisposablePgClient(config);
  await client.connect();
  return client;
}

async function connectPostgres(config = connectionString) {
  const sql = postgres(config);

  // `fetch_types` uses the extended query protocol which
  // interferes with our tests
  sql.options.fetch_types = false;

  const client = {
    sql,
    async [Symbol.asyncDispose]() {
      await sql.end();
    },
  };

  return client;
}

beforeAll(async () => {
  const server = net.createServer(async (socket) => {
    const db = new PGlite();

    await fromNodeSocket(socket, {
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

  server.listen(port);
  await once(server, 'listening');

  return () => server.close();
});

describe('pglite', () => {
  it('pg simple query returns result', async () => {
    await using client = await connectPg();
    const res = await client.query("select 'Hello world!' as message");
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
  });

  it('pg extended query returns result', async () => {
    await using client = await connectPg();
    const res = await client.query('SELECT $1::text as message', ['Hello world!']);
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
  });

  it('postgres simple query returns result', async () => {
    await using client = await connectPostgres();
    const rows = await client.sql`select 'Hello world!' as message`.simple();
    const [{ message }] = rows;
    expect(message).toBe('Hello world!');
  });

  it('postgres extended query returns result', async () => {
    await using client = await connectPostgres();
    const expectedMessage = 'Hello world!';
    const rows = await client.sql`select ${expectedMessage} as message`;
    const [{ message }] = rows;
    expect(message).toBe(expectedMessage);
  });
});
