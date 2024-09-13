import { createDuplexPair } from 'pg-gateway';
import { fromDuplexStream } from 'pg-gateway/node';
import { describe, expect, it } from 'vitest';
import {
  createPostgresClient,
  createPostgresServer,
  getPort,
  socketFromDuplexStream,
} from '../util';
import { generateAllCertificates } from './certs';

const { caCert, serverKey, serverCert, clientKey, clientCert } = await generateAllCertificates();

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

    await using client = await createPostgresClient({
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

    await using client = await createPostgresClient({
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

    await using client = await createPostgresClient({
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

    await using client = await createPostgresClient({
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

    const promise = createPostgresClient({
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

    const promise = createPostgresClient({
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

    await using client = await createPostgresClient({
      stream: socketFromDuplexStream(clientDuplex),
      ssl: {
        ca: Buffer.from(caCert),
      },
    });
  });
});
