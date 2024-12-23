import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fromNodeSocket } from 'pg-gateway/node';

const db = new PGlite();

const server = createServer(async (socket) => {
  const connection = await fromNodeSocket(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    tls: {
      key: await readFile('key.pem'),
      cert: await readFile('cert.pem'),
    },
    auth: {
      method: 'cert',
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
