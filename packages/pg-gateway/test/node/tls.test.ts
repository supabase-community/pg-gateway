import { createServer, type Server } from 'node:net';
import type { ClientConfig } from 'pg';
import { type PostgresConnectionOptions, createDuplexPair } from 'pg-gateway';
import { fromDuplexStream, fromNodeSocket } from 'pg-gateway/node';
import { describe, expect, it } from 'vitest';
import { DisposablePgClient, socketFromDuplexStream } from '../util';
import { generateCA, generateCSR, signCert, toPEM } from './certs';
import { once } from 'node:events';

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
  server.listen(0);
  await once(server, 'listening');
  return server;
}

function getPort(server: Server) {
  const address = server.address();

  if (typeof address !== 'object') {
    throw new Error(`Invalid server address '${address}'`);
  }

  if (!address) {
    throw new Error('Server has no address');
  }

  return address.port;
}

async function connectPg(config: string | ClientConfig) {
  const client = new DisposablePgClient(config);
  await client.connect();
  return client;
}

describe('tls', () => {
  it('basic tls over tcp', async () => {
    await using server = await createPostgresServer({
      auth: {
        method: 'trust',
      },
      tls: {
        cert: serverCert,
        key: serverKey,
      },
    });

    await using client = await connectPg({
      port: getPort(server),
      ssl: {
        ca: Buffer.from(caCert),
      },
    });
  });

  it('sni available when sent from client', async () => {
    await using server = await createPostgresServer({
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

    await using client = await connectPg({
      host: 'localhost',
      port: getPort(server),
      ssl: {
        ca: Buffer.from(caCert),
      },
    });
  });

  it('sni not available when omitted from client', async () => {
    await using server = await createPostgresServer({
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

    await using client = await connectPg({
      host: '127.0.0.1',
      port: getPort(server),
      ssl: {
        ca: Buffer.from(caCert),
      },
    });
  });

  it('client cert authenticates', async () => {
    await using server = await createPostgresServer({
      auth: {
        method: 'cert',
      },
      tls: {
        ca: caCert,
        cert: serverCert,
        key: serverKey,
      },
    });

    await using client = await connectPg({
      port: getPort(server),
      user: 'postgres',
      ssl: {
        ca: Buffer.from(caCert),
        cert: Buffer.from(clientCert),
        key: Buffer.from(clientKey),
      },
    });
  });

  it('client cert fails when CN !== user', async () => {
    await using server = await createPostgresServer({
      auth: {
        method: 'cert',
      },
      tls: {
        ca: caCert,
        cert: serverCert,
        key: serverKey,
      },
    });

    const promise = connectPg({
      port: getPort(server),
      user: 'bob',
      ssl: {
        ca: Buffer.from(caCert),
        cert: Buffer.from(clientCert),
        key: Buffer.from(clientKey),
      },
    });

    await expect(promise).rejects.toThrowError('client certificate is invalid');
  });

  it('wrong ca cert fails', async () => {
    await using server = await createPostgresServer({
      auth: {
        method: 'cert',
      },
      tls: {
        ca: caCert,
        cert: serverCert,
        key: serverKey,
      },
    });

    const promise = connectPg({
      port: getPort(server),
      ssl: {
        ca: Buffer.from(serverCert),
      },
    });

    await expect(promise).rejects.toThrowError('self-signed certificate in certificate chain');
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

    await using client = await connectPg({
      stream: socketFromDuplexStream(clientDuplex),
      ssl: {
        ca: Buffer.from(caCert),
      },
    });
  });
});
