// @deno-types="npm:@types/pg"
import pg from 'npm:pg';

import { expect } from 'jsr:@std/expect';
import { afterAll, beforeAll, describe, it } from 'jsr:@std/testing/bdd';
import { PGlite } from 'npm:@electric-sql/pglite';
import { fromDenoConn } from 'pg-gateway/deno';

const { Client } = pg;
let listener: Deno.TcpListener;

async function startServer(listener: Deno.TcpListener) {
  for await (const conn of listener) {
    const db = new PGlite();

    await fromDenoConn(conn, {
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
  }
}

class DisposableClient extends Client {
  async [Symbol.asyncDispose]() {
    await this.end();
  }
}

async function getClient(databaseUrl: string) {
  const client = new DisposableClient(databaseUrl);
  await client.connect();
  return client;
}

beforeAll(() => {
  listener = Deno.listen({ port: 54320 });
  startServer(listener);
});

afterAll(() => {
  listener.close();
});

describe('pglite', () => {
  it('simple query returns result', async () => {
    await using client = await getClient('postgresql://postgres:postgres@localhost:54320/postgres');
    const res = await client.query("select 'Hello world!' as message");
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
  });
});
