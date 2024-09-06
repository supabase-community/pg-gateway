import { PGlite } from '@electric-sql/pglite';
import net from 'node:net';
import pg, { type ClientConfig } from 'pg';
import postgres from 'postgres';
import { fromNodeSocket } from 'pg-gateway/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGliteExtendedQueryPatch } from '../util';

const port = 54320;
const connectionString = `postgresql://postgres:postgres@localhost:${port}/postgres`;

async function connectPg(config: string | ClientConfig = connectionString) {
  const { Client } = pg;
  const client = new Client(config);
  await client.connect();
  return client;
}

async function connectPostgres(config = connectionString) {
  const sql = postgres(config);
  return sql;
}

let server: net.Server;

beforeAll(() => {
  server = net.createServer(async (socket) => {
    const db = new PGlite();

    const connection = await fromNodeSocket(socket, {
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
  });

  server.listen(port);
});

afterAll(() => {
  server.close();
});

describe('pglite', () => {
  it('pg simple query returns result', async () => {
    const client = await connectPg();
    const res = await client.query("select 'Hello world!' as message");
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
    await client.end();
  });

  it('pg extended query returns result', async () => {
    const client = await connectPg();
    const res = await client.query('SELECT $1::text as message', ['Hello world!']);
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
    await client.end();
  });

  it('postgres simple query returns result', async () => {
    const sql = await connectPostgres();
    const rows = await sql`select 'Hello world!' as message`.simple();
    const [{ message }] = rows;
    expect(message).toBe('Hello world!');
    await sql.end();
  });

  it('postgres extended query returns result', async () => {
    const sql = await connectPostgres();
    const expectedMessage = 'Hello world!';
    const rows = await sql`select ${expectedMessage} as message`;
    const [{ message }] = rows;
    expect(message).toBe(expectedMessage);
    await sql.end();
  });
});
