import { PGlite } from '@electric-sql/pglite';
import net from 'node:net';
import { PostgresConnection, hashMd5Password } from 'pg-gateway';

const db = new PGlite();

const server = net.createServer((socket) => {
  const connection = new PostgresConnection(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    authMode: 'md5Password',
    async validateCredentials(credentials) {
      if (credentials.authMode === 'md5Password') {
        const { hash, salt } = credentials;
        const expectedHash = await hashMd5Password(
          'postgres',
          'postgres',
          salt
        );
        return hash === expectedHash;
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

server.listen(5432, () => {
  console.log('Server listening on port 5432');
});
