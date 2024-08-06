import { PGlite } from '@electric-sql/pglite';
import net from 'node:net';
import { PostgresConnection, verifySaslPassword } from 'pg-gateway';

const db = new PGlite();

const server = net.createServer((socket) => {
  const connection = new PostgresConnection(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    authMode: 'sasl',
    async validateCredentials(credentials) {
      if (credentials.authMode === 'sasl') {
        const { clientProof, salt, iterations, authMessage } = credentials;
        const storedPassword = "postgres";

        return verifySaslPassword({
          password: storedPassword,
          salt,
          iterations,
          clientProof,
          authMessage
        });
      }
      return false;
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

  socket.on('end', () => {
    console.log('Client disconnected');
  });
});

server.listen(2345, () => {
  console.log('Server listening on port 5432');
});
