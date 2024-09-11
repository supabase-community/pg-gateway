import EventEmitter from 'node:events';
import type { DuplexStream } from 'pg-gateway';
import { Client } from 'pg';

/**
 * Creates a passthrough socket object that can be passed
 * directly to the `stream` property in a `pg` `Client`.
 *
 * @example
 * const client = new Client({
 *   user: 'postgres',
 *   stream: socketFromDuplexStream(clientDuplex),
 * });
 */
export function socketFromDuplexStream(duplex: DuplexStream<Uint8Array>) {
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  return () => new PassThroughSocket(duplex) as any;
}

/**
 * Simulated Node.js `Socket` that passes data to and from
 * the provided `DuplexStream`.
 *
 * Useful with libraries like `pg` to route data
 * through custom streams, such as an in-memory duplex pair.
 */
export class PassThroughSocket extends EventEmitter {
  writer: WritableStreamDefaultWriter;
  writable = false;
  destroyed = false;
  paused = false;

  constructor(public duplex: DuplexStream<Uint8Array>) {
    super();
    this.writer = duplex.writable.getWriter();
  }

  private async emitData() {
    for await (const chunk of this.duplex.readable) {
      while (this.paused) {
        // Yield to the event loop
        await new Promise<void>((resolve) => setTimeout(resolve));
      }
      this.emit('data', Buffer.from(chunk));
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  connect() {
    this.emitData();

    // Yield to the event loop
    new Promise((resolve) => setTimeout(resolve)).then(() => {
      this.writable = true;
      this.emit('connect');
    });

    return this;
  }

  write(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    chunk: any,
    encodingOrCallback?: BufferEncoding | ((error: Error | undefined) => void),
    callback?: (error: Error | undefined) => void,
  ): boolean {
    if (typeof encodingOrCallback === 'function') {
      // biome-ignore lint/style/noParameterAssign: <explanation>
      callback = encodingOrCallback;
      // biome-ignore lint/style/noParameterAssign: <explanation>
      encodingOrCallback = undefined;
    }

    this.writer
      .write(new Uint8Array(chunk))
      .then(() => callback?.(undefined))
      .catch((err) => callback?.(err));

    return true;
  }

  end() {
    this.writable = false;
    this.emit('close');
    return this;
  }

  destroy() {
    this.destroyed = true;
    this.end();
    return this;
  }

  startTls() {
    throw new Error('TLS is not supported in pass-through sockets');
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

  cork() {}

  uncork() {}
}

export class DisposablePgClient extends Client {
  async [Symbol.asyncDispose]() {
    await this.end();
  }
}
