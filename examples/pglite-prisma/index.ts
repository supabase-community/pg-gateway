import { PGlite } from '@electric-sql/pglite';
import net, { connect } from 'node:net';
import { getMessages, PostgresConnection } from 'pg-gateway';

const server = net.createServer(async (socket) => {
  // Create an ephemeral in-memory DB for each connection
  const db = new PGlite();

  // Establish a TCP connection to the downstream server using the above host/port
  // const proxySocket = connect({ host: 'localhost', port: 54321 });

  // proxySocket.on('end', () => socket.end());
  // proxySocket.on('end', () => console.log('end'));
  // socket.on('end', () => proxySocket.end());
  // socket.on('end', () => console.log('end'));

  // proxySocket.on('error', (err) => socket.destroy(err));
  // proxySocket.on('error', () => console.log('error'));
  // socket.on('error', (err) => proxySocket.destroy(err));
  // socket.on('error', () => console.log('error'));

  // proxySocket.on('close', () => socket.destroy());
  // proxySocket.on('close', () => console.log('close'));
  // socket.on('close', () => proxySocket.destroy());
  // socket.on('close', () => console.log('close'));

  // await new Promise<void>((resolve) =>
  //   proxySocket.once('connect', () => {
  //     resolve();
  //   }),
  // );

  // proxySocket.pause();

  // socket.on('data', async (data) => {
  //   for await (const message of getMessages(data)) {
  //     console.log('frontend message', message);
  //   }
  // });

  // proxySocket.on('data', async (data) => {
  //   for await (const message of getMessages(data)) {
  //     console.log('backend message', message);
  //   }
  // });

  // socket.pipe(proxySocket);
  // proxySocket.pipe(socket);

  let isExtendedQuery = false;
  let extendedQueryBuffer: Uint8Array[] = [];

  const connection = new PostgresConnection(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    // auth: {
    //   method: 'password',
    //   getClearTextPassword() {
    //     return 'postgres';
    //   },
    // },
    async onStartup(state) {
      console.log('startup', state);
      // Wait for PGlite to be ready before further processing
      await db.waitReady;
    },
    // async onMessage(data) {
    //   if (isExtendedQuery) {
    //     extendedQueryBuffer.push(data);

    //     if (data[0] === 0x53) {
    //       console.log('found sync');
    //       const combined = concatUint8Arrays(extendedQueryBuffer);
    //       extendedQueryBuffer = [];
    //       isExtendedQuery = false;
    //       console.log('combined', combined);
    //       // const response = await db.execProtocolRaw(combined);
    //       new Promise<void>((resolve, reject) =>
    //         proxySocket.write(combined, (err) =>
    //           err ? reject(err) : resolve(),
    //         ),
    //       );
    //       const response = await new Promise<Buffer>((resolve, reject) =>
    //         proxySocket.once('readable', () => {
    //           const data = proxySocket.read();
    //           resolve(data);
    //         }),
    //       );
    //       return response;
    //     }

    //     return new Uint8Array();
    //   }

    //   if (data[0] === 0x50) {
    //     isExtendedQuery = true;
    //     extendedQueryBuffer.push(data);
    //     return new Uint8Array();
    //   }

    //   new Promise<void>((resolve, reject) =>
    //     proxySocket.write(data, (err) => (err ? reject(err) : resolve())),
    //   );

    //   const response = await new Promise<Buffer>((resolve, reject) =>
    //     proxySocket.once('readable', () => {
    //       const data = proxySocket.read();
    //       resolve(data);
    //     }),
    //   );

    //   return new Uint8Array(response);
    // },
    async onMessage(data, { isAuthenticated }) {
      // Only forward messages to PGlite after authentication
      if (!isAuthenticated) {
        return;
      }

      if (data[0] === 0x50) {
        isExtendedQuery = true;
        console.log('extended query on');
      } else if (data[0] === 0x53) {
        // isExtendedQuery = false;
        // console.log('extended query off');
        await db.execProtocolRaw(data);
        const messages = [
          ...extendedQueryBuffer,
          new Uint8Array([90, 0, 0, 0, 5, 73]),
        ];
        extendedQueryBuffer = [];
        return messages;
      }

      // Forward raw message to PGlite
      const response = await db.execProtocolRaw(data);

      if (isExtendedQuery) {
        const messages = getMessages(response);

        const filtered = Array.from(messages)
          .filter((message) => message[0] !== 0x5a)
          .map((message) => message.slice());

        extendedQueryBuffer.push(...filtered);

        return new Uint8Array();
      }

      return response;
    },
  });

  socket.on('end', () => {
    console.log('Client disconnected');
  });
});

server.listen(5432, async () => {
  console.log('Server listening on port 5432');
});

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  // Calculate the total length of the final Uint8Array
  const totalLength = arrays.reduce((acc, curr) => acc + curr.length, 0);

  // Create a new Uint8Array with the calculated length
  const result = new Uint8Array(totalLength);

  // Keep track of the current offset
  let offset = 0;

  // Copy each Uint8Array into the result
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}
