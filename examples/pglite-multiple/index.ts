import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { mkdir, readFile } from 'node:fs/promises';
import net from 'node:net';
import { type TlsOptionsCallback, createPreHashedPassword } from 'pg-gateway';
import { fromNodeSocket } from 'pg-gateway/node';

const tls: TlsOptionsCallback = async ({ sniServerName }) => {
  // Optionally serve different certs based on `sniServerName`
  // In this example we'll use a single wildcard cert for all servers (ie. *.db.example.com)
  return {
    key: await readFile('server-key.pem'),
    cert: await readFile('server-cert.pem'),
    ca: await readFile('ca-cert.pem'),
  };
};

function getIdFromServerName(serverName: string) {
  // In this example the left-most subdomain contains the ID
  // ie. 12345.db.example.com -> 12345
  const [id] = serverName.split('.');
  return id;
}

const server = net.createServer(async (socket) => {
  let db: PGliteInterface;

  const connection = await fromNodeSocket(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    auth: {
      method: 'md5',
      getPreHashedPassword: async ({ username }) => {
        return createPreHashedPassword(username, 'postgres');
      },
    },
    tls,
    async onTlsUpgrade({ tlsInfo }) {
      if (!tlsInfo) {
        connection.sendError({
          severity: 'FATAL',
          code: '08000',
          message: 'ssl connection required',
        });
        throw new Error('end socket');
      }

      if (!tlsInfo.sniServerName) {
        connection.sendError({
          severity: 'FATAL',
          code: '08000',
          message: 'ssl sni extension required',
        });
        throw new Error('end socket');
      }

      const databaseId = getIdFromServerName(tlsInfo.sniServerName);

      db = new PGlite(`./dbs/${databaseId}`);
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

server.listen(5432, async () => {
  console.log('Server listening on port 5432');

  await mkdir('./dbs', { recursive: true });
});
