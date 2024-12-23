import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:net';
import { createPreHashedPassword } from 'pg-gateway';
import { fromNodeSocket } from 'pg-gateway/node';

const db = new PGlite();

const server = createServer(async (socket) => {
  const connection = await fromNodeSocket(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    auth: {
      method: 'md5',
      getPreHashedPassword({ username }) {
        return createPreHashedPassword(username, 'postgres');
      },
    },
    async onStartup() {
      // Wait for PGlite to be ready before further processing
      await db.waitReady;
    },
    async onMessage(data, { isAuthenticated }) {
      // Only forward messages to PGlite after authentication
      if (!isAuthenticated) {
        return;
      }

      // Forward raw message to PGlite and send response to client
      return await db.execProtocolRaw(data);
    },
  });

  socket.on('end', () => {
    console.log('Client disconnected');
  });
});

server.listen(5432, () => {
  console.log('Server listening on port 5432');
});
