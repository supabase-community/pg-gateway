import { PGlite } from '@electric-sql/pglite';
import { type Duplex, EventEmitter } from 'node:stream';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { createDuplexPair, type DuplexStream, PostgresConnection } from 'pg-gateway';
import { describe, expect, it } from 'vitest';

const { Client } = pg;

/**
 * Creates a one-time `PostgresConnection` and links to an
 * in-memory client `DuplexStream`.
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
    stream: () => new DuplexStreamSocket(clientDuplex) as unknown as Duplex,
  });
  await client.connect();
  return client;
}

describe('pglite', () => {
  it('simple query returns result', async () => {
    const client = await connect();
    const res = await client.query("select 'Hello world!' as message");
    const [{ message }] = res.rows;
    expect(message).toBe('Hello world!');
    await client.end();
  });
});

class DuplexStreamSocket extends EventEmitter {
  writer: WritableStreamDefaultWriter;
  writable = false;
  destroyed = false;

  constructor(public duplex: DuplexStream<Uint8Array>) {
    super();
    this.writer = duplex.writable.getWriter();
  }

  private async emitData() {
    for await (const chunk of this.duplex.readable) {
      this.emit('data', Buffer.from(chunk));
    }
  }

  async connect() {
    this.emitData();

    // Yield to the event loop
    await setTimeout();

    this.writable = true;
    this.emit('connect');
  }

  async write(data: Buffer, callback?: () => void) {
    await this.writer.write(new Uint8Array(data));
    callback?.();
  }

  end() {
    this.writable = false;
    this.emit('close');
  }

  destroy() {
    this.destroyed = true;
    this.end();
  }

  startTls() {
    throw new Error('TLS not supported in in-memory connection');
  }

  setNoDelay() {
    return this;
  }

  setKeepAlive() {
    return this;
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }
}
