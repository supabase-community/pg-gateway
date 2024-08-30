import { PGlite } from '@electric-sql/pglite';
import net from 'node:net';
import pg, { type ClientConfig } from 'pg';
import { fromNodeSocket } from 'pg-gateway/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
});
