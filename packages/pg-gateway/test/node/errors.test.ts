import { BackendError } from 'pg-gateway';
import { describe, expect, it, vi } from 'vitest';
import { createPostgresClient, createPostgresServer, getPort } from '../util';
import { generateAllCertificates } from './certs';

describe('errors', () => {
  it('sends backend error thrown in onTlsUpgrade to the client', async () => {
    const { caCert, serverKey, serverCert } = await generateAllCertificates();
    await using server = await createPostgresServer({
      tls: {
        cert: serverCert,
        key: serverKey,
      },
      async onTlsUpgrade() {
        throw BackendError.create({
          message: 'onTlsUpgrade failed',
          code: 'P0000',
          severity: 'FATAL',
        });
      },
    });
    const promise = createPostgresClient({
      port: getPort(server),
      ssl: {
        ca: Buffer.from(caCert),
      },
    });
    await expect(promise).rejects.toThrow('onTlsUpgrade failed');
  });

  it('sends backend error thrown in onAuthenticated to the client', async () => {
    await using server = await createPostgresServer({
      async onAuthenticated() {
        throw BackendError.create({
          message: 'onAuthenticated failed',
          code: 'P0000',
          severity: 'FATAL',
        });
      },
    });
    const promise = createPostgresClient({
      port: getPort(server),
    });
    await expect(promise).rejects.toThrow('onAuthenticated failed');
  });

  it('sends backend error thrown in onStartup to the client', async () => {
    await using server = await createPostgresServer({
      async onStartup() {
        throw BackendError.create({
          message: 'onStartup failed',
          code: 'P0000',
          severity: 'FATAL',
        });
      },
    });
    const promise = createPostgresClient({
      port: getPort(server),
    });
    await expect(promise).rejects.toThrow('onStartup failed');
  });

  it('sends backend error thrown in onMessage to the client', async () => {
    await using server = await createPostgresServer({
      async onMessage() {
        throw BackendError.create({
          message: 'onMessage failed',
          code: 'P0000',
          severity: 'FATAL',
        });
      },
    });
    const promise = createPostgresClient({
      port: getPort(server),
    });
    await expect(promise).rejects.toThrow('onMessage failed');
  });

  const mockOutput = () => {
    const output = {
      stderr: '',
      [Symbol.dispose]() {
        consoleErrorMock.mockRestore();
      },
    };
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation((...args) => {
      output.stderr += args.join(' ');
    });
    return output;
  };

  it('does not send non backend errors to the client', async () => {
    using output = mockOutput();
    await using server = await createPostgresServer({
      async onMessage() {
        throw Error('wat?');
      },
    });
    const promise = createPostgresClient({
      port: getPort(server),
    });
    try {
      await promise;
    } catch (error) {
      expect(error.message).not.toContain('wat?');
      expect(output.stderr).toContain('wat?');
      expect(error.message).toContain('Connection terminated unexpectedly');
    }
  });
});
