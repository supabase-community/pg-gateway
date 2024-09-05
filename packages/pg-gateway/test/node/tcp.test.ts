import { PGlite } from '@electric-sql/pglite';
import net from 'node:net';
import pg, { type ClientConfig } from 'pg';
import { fromNodeSocket } from 'pg-gateway/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGliteExtendedQueryPatch } from '../util';

const { Client } = pg;

async function connect(
  config: string | ClientConfig = 'postgresql://postgres:postgres@localhost:54320/postgres',
) {
  const client = new Client(config);
  await client.connect();
  return client;
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

  server.listen(54320);
});

afterAll(() => {
  server.close();
});

describe('pglite', () => {
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
