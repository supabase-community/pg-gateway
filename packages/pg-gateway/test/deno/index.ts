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

    fromDenoConn(conn, {
      async onStartup() {
        // Wait for PGlite to be ready before further processing
        await db.waitReady;
      },
      async onMessage(data, { isAuthenticated }) {
        // Only forward messages to PGlite after authentication
        if (!isAuthenticated) {
          return;
        }

        // Forward raw message to PGlite and send response to client
        return await db.execProtocolRaw(data);
      },
    });
  }
}

async function connect() {
  const client = new Client('postgresql://postgres:postgres@localhost:5432/postgres');
  await client.connect();
  return client;
}

beforeAll(() => {
  listener = Deno.listen({ port: 5432 });
  startServer(listener);
});

afterAll(() => {
  listener.close();
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
