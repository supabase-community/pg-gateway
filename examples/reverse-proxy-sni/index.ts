import { readFile } from 'node:fs/promises';
import net, { connect } from 'node:net';
import { PostgresConnection, type TlsOptionsCallback } from 'pg-gateway';

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
  const connection = new PostgresConnection(socket, {
    tls,
    // This hook occurs before startup messages are received from the client,
    // so is a good place to establish proxy connections
    async onTlsUpgrade({ tlsInfo }) {
      if (!tlsInfo) {
        connection.sendError({
          severity: 'FATAL',
          code: '08000',
          message: 'ssl connection required',
        });
        connection.socket.end();
        return;
      }

      if (!tlsInfo.sniServerName) {
        connection.sendError({
          severity: 'FATAL',
          code: '08000',
          message: 'ssl sni extension required',
        });
        connection.socket.end();
        return;
      }

      // In this example the left-most subdomain contains the server ID
      // ie. 12345.db.example.com -> 12345
      const [serverId] = tlsInfo.sniServerName.split('.');

      if (!serverId) {
        connection.sendError({
          severity: 'FATAL',
          code: '08000',
          message: 'server id required',
        });
        connection.socket.end();
        return;
      }

      // Lookup the server host/port based on ID
      const serverInfo = await getServerById(serverId);

      // Establish a TCP connection to the downstream server using the above host/port
      const proxySocket = connect(serverInfo);

      // Detach from the `PostgresConnection` to prevent further buffering/processing
      const socket = connection.detach();

      // Pipe data directly between sockets
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);

      proxySocket.on('end', () => socket.end());
      socket.on('end', () => proxySocket.end());

      proxySocket.on('error', (err) => socket.destroy(err));
      socket.on('error', (err) => proxySocket.destroy(err));

      proxySocket.on('close', () => socket.destroy());
      socket.on('close', () => proxySocket.destroy());
    },
  });

  socket.on('end', () => {
    console.log('Client disconnected');
  });
});

server.listen(5432, () => {
  console.log('Server listening on port 5432');
});
