import { PGlite } from '@electric-sql/pglite';
import { Mutex, withTimeout } from 'async-mutex';
import net from 'node:net';
import { PostgresConnection, hashMd5Password } from '../../src';

const db = new PGlite();
const mutex = withTimeout(new Mutex(), 5000);

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
    async onMessage(data, { isAuthenticated }) {
      // Only forward messages to PGlite after authentication
      if (!isAuthenticated) {
        return false;
      }

      try {
        // All sockets share the same PGlite connection (runs in single-user mode),
        // so we need a mutex to queue requests
        await mutex.runExclusive(async () => {
          // Forward raw message to PGlite
          const responseData = await db.execProtocolRaw(data);
          connection.sendData(responseData);
        });
      } catch (err) {
        console.warn('Mutex timeout');

        // TODO: something more graceful than closing the connection
        socket.end();
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
