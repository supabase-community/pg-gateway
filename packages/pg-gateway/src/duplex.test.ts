import { describe, expect, it } from 'vitest';
import { createDuplexPair, createVirtualServer } from './duplex';

describe('createDuplexPair', () => {
  it('should transfer data between duplex streams using Uint8Array', async () => {
    const [duplexA, duplexB] = createDuplexPair<Uint8Array>();

    const writerA = duplexA.writable.getWriter();
    const writerB = duplexB.writable.getWriter();

    const messageFromA = new Uint8Array([72, 101, 108, 108, 111]); // "Hello" in ASCII
    const messageFromB = new Uint8Array([87, 111, 114, 108, 100]); // "World" in ASCII

    await writerA.write(messageFromA);
    await writerA.close();
    await writerB.write(messageFromB);
    await writerB.close();

    const decoder = new TextDecoder();

    for await (const chunk of duplexB.readable) {
      const value = decoder.decode(chunk);
      expect(value).toBe('Hello');
      break;
    }

    for await (const chunk of duplexA.readable) {
      const value = decoder.decode(chunk);
      expect(value).toBe('World');
      break;
    }
  });
});

describe('createVirtualServer', () => {
  it('should allow a client to connect and exchange data with the server', async () => {
    const { listen, connect } = createVirtualServer<Uint8Array>();
    const decoder = new TextDecoder();

    const messageFromClient = new Uint8Array([72, 101, 108, 108, 111]); // "Hello" in ASCII
    const messageFromServer = new Uint8Array([87, 111, 114, 108, 100]); // "World" in ASCII

    const clientConn = await connect();

    const clientWriter = clientConn.writable.getWriter();
    await clientWriter.write(messageFromClient);
    await clientWriter.close();

    for await (const conn of listen()) {
      for await (const chunk of conn.readable) {
        const value = decoder.decode(chunk);
        expect(value).toBe('Hello');
        break;
      }

      const serverWriter = conn.writable.getWriter();
      await serverWriter.write(messageFromServer);
      await serverWriter.close();

      break;
    }

    for await (const chunk of clientConn.readable) {
      const value = decoder.decode(chunk);
      expect(value).toBe('World');
      break;
    }
  });
});
