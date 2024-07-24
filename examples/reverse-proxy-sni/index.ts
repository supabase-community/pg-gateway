import { readFile } from 'node:fs/promises';
import net, { connect, Socket } from 'node:net';
import { PostgresConnection, TlsOptionsCallback } from '../../src';

const tls: TlsOptionsCallback = async ({ sniServerName }) => {
  // Optionally serve different certs based on `sniServerName`
  // In this example we'll use a single wildcard cert for all servers (ie. *.db.example.com)
  return {
    key: await readFile('server-key.pem'),
    cert: await readFile('server-cert.pem'),
    ca: await readFile('ca-cert.pem'),
  };
};

// Looks up the host/port based on the ID
async function getServerById(id: string) {
  // In this example we'll hardcode to localhost port 54321
  return {
    host: 'localhost',
    port: 54321,
  };
}

const server = net.createServer((socket) => {
  let proxySocket: Socket;

  const connection = new PostgresConnection(socket, {
    tls,
    async onTlsUpgrade({ tlsInfo }) {
      console.log({ tlsInfo });
      if (!tlsInfo) {
        connection.sendError({
          severity: 'FATAL',
          code: '08000',
          message: `ssl connection required`,
        });
        socket.end();
        return;
      }

      if (!tlsInfo.sniServerName) {
        connection.sendError({
          severity: 'FATAL',
          code: '08000',
          message: `ssl sni extension required`,
        });
        socket.end();
        return;
      }

      // In this example the left-most subdomain contains the server ID
      // ie. 12345.db.example.com -> 12345
      const [serverId] = tlsInfo.sniServerName.split('.');

      // Lookup the server host/port based on ID
      const serverInfo = await getServerById(serverId);

      proxySocket = connect(serverInfo);

      proxySocket.on('data', (data) => {
        connection.sendData(data);
      });

      proxySocket.on('end', () => {
        socket.end();
      });

      return;
    },
    async onMessage(data, { tlsInfo }) {
      // Only forward messages after the connection has been upgraded to TLS
      if (!tlsInfo) {
        return false;
      }

      if (!proxySocket) {
        connection.sendError({
          severity: 'FATAL',
          code: 'XX000',
          message: `internal error connecting to proxy socket`,
        });
        socket.end();
        return true;
      }

      proxySocket.write(data);
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
