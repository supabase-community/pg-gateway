import net from 'node:net';
import { PostgresConnection } from 'pg-gateway';

const server = net.createServer((socket) => {
  const connection = new PostgresConnection(socket, {
    async *onQuery(query) {
      const commands = query.split(';').filter((command) => !!command);

      for (const command of commands) {
        yield {
          command: 'select',
          fields: [
            {
              name: 'response',
              dataType: {
                id: 1,
              },
            },
          ],
          async *rows() {
            yield { response: `You asked '${command}'` };
          },
        };
      }
    },
  });

  socket.on('end', () => {
    console.log('Client disconnected');
  });
});

server.listen(5432, () => {
  console.log('Server listening on port 5432');
});
