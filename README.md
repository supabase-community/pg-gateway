# pg-gateway

TypeScript library that implements the Postgres wire protocol from the server-side. It provides APIs you can hook into to handle authentication requests, queries, and other client messages yourself.

## Why?

This acts as a layer in front of your Postgres database (or any other database). You could use it for:

- Serving [PGlite](https://github.com/electric-sql/pglite) over TCP
- Serving a non-Postgres database via the Postgres wire protocol
- Adding a reverse proxy in front of your databases
- Creating a custom connection pooler

## Usage

_This library is in active development, so APIs are still WIP. It is pre-1.0 so expect some breaking changes to the API._

Here is an example that serves [PGlite](https://github.com/electric-sql/pglite) over TCP:

```typescript
import { PGlite } from '@electric-sql/pglite';
import net from 'node:net';
import { PostgresConnection } from 'pg-gateway';

const db = new PGlite();

const server = net.createServer((socket) => {
  const connection = new PostgresConnection(socket, {
    serverVersion: '16.3 (PGlite 0.2.0)',
    authMode: 'cleartextPassword',

    // Validate user credentials based on auth mode chosen
    async validateCredentials(credentials) {
      if (credentials.authMode === 'cleartextPassword') {
        const { user, password } = credentials;
        return user === 'postgres' && password === 'postgres';
      }
      return false;
    },

    // Hook into each client message
    async onMessage(data, { isAuthenticated }) {
      // Only forward messages to PGlite after authentication
      if (!isAuthenticated) {
        return false;
      }

      // Forward raw message to PGlite
      try {
        const [[_, responseData]] = await db.execProtocol(data);
        connection.sendData(responseData);
      } catch (err) {
        connection.sendError(err);
      }
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
```

More usage/examples coming soon.

## Development

```shell
npm run dev
```

## License

MIT
