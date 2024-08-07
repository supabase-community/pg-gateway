import { pbkdf2Sync, randomBytes } from 'node:crypto';
import net from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import {
  PostgresConnection,
  createSaslMetadata,
  verifySaslPassword,
} from 'pg-gateway';

const db = new PGlite();

let metadata: {
  salt: string;
  iterations: number;
  storedKey: string;
  serverKey: string;
};

const server = net.createServer((socket) => {
  const connection = new PostgresConnection(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    auth: {
      mode: 'sasl',
      async getMetadata({ username }) {
        if (!metadata) {
          metadata = createSaslMetadata('postgres');
        }
        return metadata;
      },
      async validateCredentials(credentials) {
        const { authMessage, clientProof, metadata } = credentials;

        return verifySaslPassword({
          authMessage,
          clientProof,
          storedKey: metadata.storedKey,
        });
      },
    },
    async onStartup() {
      // Wait for PGlite to be ready before further processing
      await db.waitReady;
      return false;
    },
    async onMessage(data, { isAuthenticated }) {
      // Only forward messages to PGlite after authentication
      if (!isAuthenticated) {
        return false;
      }

      // Forward raw message to PGlite
      try {
        const [[_, responseData]] = await db.execProtocol(data);
        connection.sendData(responseData);
      } catch (err) {
        connection.sendError(err);
        connection.sendReadyForQuery();
      }
      return true;
    },
  });

  socket.on('close', () => {
    console.log('Client disconnected');
  });
});

server.listen(2345, () => {
  console.log('Server listening on port 5432');
});
