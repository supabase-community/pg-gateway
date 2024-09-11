import { createServer } from 'node:net';
import pg, { type ClientConfig } from 'pg';
import { type PostgresConnectionOptions, createDuplexPair } from 'pg-gateway';
import { fromDuplexStream, fromNodeSocket } from 'pg-gateway/node';
import { describe, expect, it } from 'vitest';
import { socketFromDuplexStream } from '../util';
import { generateCA, generateCSR, signCert, toPEM } from './certs';

async function generateAllCertificates() {
  const { caKey, caCert } = await generateCA('My Root CA');

  const { key: serverKey, csr: serverCsr } = await generateCSR('localhost');
  const serverCert = await signCert(caCert, caKey, serverCsr);

  const { key: clientKey, csr: clientCsr } = await generateCSR('postgres');
  const clientCert = await signCert(caCert, caKey, clientCsr);

  const encoder = new TextEncoder();

  return {
    caKey: encoder.encode(toPEM(caKey, 'PRIVATE KEY')),
    caCert: encoder.encode(toPEM(caCert, 'CERTIFICATE')),
    serverKey: encoder.encode(toPEM(serverKey, 'PRIVATE KEY')),
    serverCert: encoder.encode(toPEM(serverCert, 'CERTIFICATE')),
    clientKey: encoder.encode(toPEM(clientKey, 'PRIVATE KEY')),
    clientCert: encoder.encode(toPEM(clientCert, 'CERTIFICATE')),
  };
}

const { caCert, serverKey, serverCert, clientKey, clientCert } = await generateAllCertificates();

async function createPostgresServer(options?: PostgresConnectionOptions) {
  const server = createServer((socket) => fromNodeSocket(socket, options));

  // Listen on a random free port
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();

  if (typeof address !== 'object') {
    throw new Error(`Invalid server address '${address}'`);
  }

  if (!address) {
    throw new Error('Server has no address');
  }

  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return { server, port: address.port, close };
}

async function connectPg(config: string | ClientConfig) {
  const { Client } = pg;
  const client = new Client(config);
  await client.connect();
  return client;
}

describe('tls', () => {
  it('basic tls over tcp', async () => {
    const { port, close } = await createPostgresServer({
      auth: {
        method: 'trust',
      },
      tls: {
        cert: serverCert,
        key: serverKey,
      },
    });

    try {
      const client = await connectPg({
        port,
        ssl: {
          ca: Buffer.from(caCert),
        },
      });

      await client.end();
    } finally {
      await close();
    }
  });

  it('sni available when sent from client', async () => {
    const { port, close } = await createPostgresServer({
      auth: {
        method: 'trust',
      },
      tls: {
        cert: serverCert,
        key: serverKey,
      },
      onTlsUpgrade({ tlsInfo }) {
        expect(tlsInfo?.serverName).toBe('localhost');
      },
    });

    try {
      const client = await connectPg({
        host: 'localhost',
        port,
        ssl: {
          ca: Buffer.from(caCert),
        },
      });

      await client.end();
    } finally {
      await close();
    }
  });

  it('sni not available when omitted from client', async () => {
    const { port, close } = await createPostgresServer({
      auth: {
        method: 'trust',
      },
      tls: {
        cert: serverCert,
        key: serverKey,
      },
      onTlsUpgrade({ tlsInfo }) {
        expect(tlsInfo?.serverName).not.toBeDefined();
      },
    });

    try {
      const client = await connectPg({
        host: '127.0.0.1',
        port,
        ssl: {
          ca: Buffer.from(caCert),
        },
      });

      await client.end();
    } finally {
      await close();
    }
  });

  it('client cert authenticates', async () => {
    const { port, close } = await createPostgresServer({
      auth: {
        method: 'cert',
      },
      tls: {
        ca: caCert,
        cert: serverCert,
        key: serverKey,
      },
    });

    try {
      const client = await connectPg({
        port,
        user: 'postgres',
        ssl: {
          ca: Buffer.from(caCert),
          cert: Buffer.from(clientCert),
          key: Buffer.from(clientKey),
        },
      });

      await client.end();
    } finally {
      await close();
    }
  });

  it('client cert fails when CN !== user', async () => {
    const { port, close } = await createPostgresServer({
      auth: {
        method: 'cert',
      },
      tls: {
        ca: caCert,
        cert: serverCert,
        key: serverKey,
      },
    });

    try {
      const promise = connectPg({
        port,
        user: 'bob',
        ssl: {
          ca: Buffer.from(caCert),
          cert: Buffer.from(clientCert),
          key: Buffer.from(clientKey),
        },
      });

      await expect(promise).rejects.toThrowError('client certificate is invalid');
    } finally {
      await close();
    }
  });

  it('wrong ca cert fails', async () => {
    const { port, close } = await createPostgresServer({
      auth: {
        method: 'cert',
      },
      tls: {
        ca: caCert,
        cert: serverCert,
        key: serverKey,
      },
    });

    try {
      const promise = connectPg({
        port,
        ssl: {
          ca: Buffer.from(serverCert),
        },
      });

      await expect(promise).rejects.toThrowError('self-signed certificate in certificate chain');
    } finally {
      await close();
    }
  });

  it('basic tls over in-memory duplex pair', async () => {
    const [clientDuplex, serverDuplex] = createDuplexPair<Uint8Array>();

    await fromDuplexStream(serverDuplex, {
      auth: {
        method: 'trust',
      },
      tls: {
        ca: caCert,
        cert: serverCert,
        key: serverKey,
      },
    });

    const client = await connectPg({
      stream: socketFromDuplexStream(clientDuplex),
      ssl: {
        ca: Buffer.from(caCert),
      },
    });

    await client.end();
  });
});
