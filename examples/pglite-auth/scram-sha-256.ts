import net from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import {
  type BackendError,
  PostgresConnection,
  createScramSha256Data,
} from 'pg-gateway';

const db = new PGlite();

const server = net.createServer((socket) => {
  const connection = new PostgresConnection(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    auth: {
      method: 'scram-sha-256',
      async getScramSha256Data(credentials) {
        return createScramSha256Data('postgres');
      },
    },
    async onTlsUpgrade({ tlsInfo }) {
      console.log(tlsInfo);
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
        const [result] = await db.execProtocol(data);
        if (result) {
          const [_, responseData] = result;
          connection.sendData(responseData);
        }
      } catch (err) {
        connection.sendError(err as BackendError);
        connection.sendReadyForQuery();
      }
      return true;
    },
  });

  socket.on('close', () => {
    console.log('Client disconnected');
  });
});

server.listen(5432, () => {
  console.log('Server listening on port 5432');
});
