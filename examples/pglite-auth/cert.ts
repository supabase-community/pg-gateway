import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import net from 'node:net';
import { fromNodeSocket } from 'pg-gateway/node';

const db = new PGlite();

const server = net.createServer(async (socket) => {
  const connection = await fromNodeSocket(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    tls: {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem'),
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
