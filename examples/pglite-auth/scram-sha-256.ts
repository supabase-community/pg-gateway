import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:net';
import { createScramSha256Data } from 'pg-gateway';
import { fromNodeSocket } from 'pg-gateway/node';

const db = new PGlite();

const server = createServer(async (socket) => {
  const connection = await fromNodeSocket(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    auth: {
      method: 'scram-sha-256',
      async getScramSha256Data(credentials) {
        // Utility function to generate scram-sha-256 data (like salt) for the given user
        // You would likely store this info in a database and retrieve it here
        return createScramSha256Data('postgres');
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

  socket.on('close', () => {
    console.log('Client disconnected');
  });
});

server.listen(5432, () => {
  console.log('Server listening on port 5432');
});
