import * as fs from 'node:fs';
import net from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import {
  type BackendError,
  PostgresConnection,
  type ScramSha256Data,
  createScramSha256Data,
} from 'pg-gateway';

const db = new PGlite();

let data: ScramSha256Data | undefined;

const server = net.createServer((socket) => {
  const connection = new PostgresConnection(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    tls: {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem'),
    },
    auth: {
      method: 'scram-sha-256',
      async getScramSha256Data({ username }) {
        if (!data) {
          // helper function to create the metadata for SASL auth
          data = createScramSha256Data('postgres');
        }
        return data;
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

server.listen(2345, () => {
  console.log('Server listening on port 5432');
});
