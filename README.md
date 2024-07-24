# pg-gateway

TypeScript library that implements the Postgres wire protocol from the server-side. It provides APIs you can hook into to handle authentication requests, queries, and other client messages yourself.

## Why?

This acts as a layer in front of your Postgres database (or any other database). You could use it for:

- Serving [PGlite](#pglite) over TCP
- Serving a non-Postgres database via the Postgres wire protocol
- Adding a reverse proxy in front of your databases
- Creating a custom connection pooler

## Features

- **Authentication:** Supports multiple auth modes - currently `cleartextPassword`, `md5Password`, and `certificate` (more planned)
- **TLS Encryption:** Handles standard TLS (SSL) upgrades
- **Modular:** You control the server while the library manages the protocol
- **Hooks:** Hook into various points in the protocol's lifecycle (auth, query, etc)
- **Escape hatch:** Access the raw protocol messages at any point in the lifecycle
- **Examples:** Various examples on how you might use this library

## Usage

_This library is in active development, so APIs are still WIP. It is pre-1.0 so expect some breaking changes to the API._

This library is designed to give you as much control as possible while still managing the protocol lifecycle.

Start by creating your own TCP server (ie. via `node:net`), then pass the socket into a `PostgresConnection`:

```typescript
import { createServer } from 'node:net';
import { PostgresConnection } from 'pg-gateway';

// Create a TCP server
const server = createServer((socket) => {
  // `PostgresConnection` will manage the protocol lifecycle
  const connection = new PostgresConnection(socket);
});

// Listen on the desired port
server.listen(5432, () => {
  console.log('Server listening on port 5432');
});
```

`PostgresConnection` exposes a number of options and hooks as its second argument:

### `serverVersion`

Specifies the version of the server to return back to the client. Can include any arbitrary string.

```typescript
const connection = new PostgresConnection(socket, {
  serverVersion: '16.3 (MyCustomPG)',
});
```

### `authMode`

Specifies which auth mode you want to use with clients. Current modes supported are:

- `none`: No password is requested. Client will be immediately authenticate after startup.
- `cleartextPassword`: Password is sent in plain text by the client. Least secure option.
- `md5Password`: Password is hashed using Postgres' [nested MD5 algorithm](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-START-UP) before it is sent to the server.
- `certificate`: A client TLS certificate is requested. Its common name (CN) must match the `user` field to authenticate. It must also be signed by a certificate authority (CA) known to the server (see [TLS](#tls)). Requires a TLS connection.

```typescript
const connection = new PostgresConnection(socket, {
  authMode: `md5Password`,
});
```

### `tls`

Like the real Postgres server, TLS connections are established as an upgrade mechanism after the initial handshake (`SSLRequest` message from the client).

The `tls` option is an object that contains the following:

- `key`: A `Buffer` containing the TLS private key in PEM format
- `cert`: A `Buffer` containing the TLS cert chain in PEM format. Includes the TLS cert followed by any intermediate certs (not including root CA).
- `ca`: A `Buffer` containing the certificate authority (CA) in PEM format. Optional - if omitted, the runtime's built-in CAs will be used.
- `passphrase` A `string` containing the passphrase for `key`. Optional - only needed if `key` is encrypted.

When this option is passed, the server will require a TLS connection with the client. If the client doesn't send an `SSLRequest` message, the server will close the connection with an error.

If this option is not passed, the server will respond to `SSLRequest` messages with a message stating that SSL is not supported. At that point, clients can decide whether or not they want to continue the connection over an unencrypted channel.

```typescript
const tls: TlsOptions = {
  key: readFileSync('server-key.pem'),
  cert: readFileSync('server-cert.pem'),
  ca: readFileSync('ca-cert.pem'),
};

const connection = new PostgresConnection(socket, {
  tls,
});
```

### `validateCredentials()`

This hook allows you to authenticate credentials based on the [auth mode](#authmode). Returning `true` indicates that the credentials are valid and `false` indicates that they are invalid. If the credentials are marked invalid, the server will close the connection with an error. The function can be both synchronous or asynchronous.

The `credentials` object passed to the function will contain different properties based on the auth mode:

- `cleartextPassword`:

  - `authMode`: `'cleartextPassword'`;
  - `user`: `string`;
  - `password`: `string`;

- `md5Password`:
  - `authMode`: `'md5Password'`;
  - `user`: `string`;
  - `hash`: `string`;
  - `salt`: `Uint8Array`;

You can use TypeScript's [discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) to narrow the type of `credentials` before accessing its properties:

```typescript
import { PostgresConnection, hashMd5Password } from 'pg-gateway';

// ...

const connection = new PostgresConnection(socket, {
  async validateCredentials(credentials) {
    if (credentials.authMode === 'md5Password') {
      const { hash, salt } = credentials;
      const expectedHash = await hashMd5Password('postgres', 'postgres', salt);
      return hash === expectedHash;
    }
    return false;
  },
});
```

### `onMessage()`

This hook gives you access to raw messages at any point in the protocol lifecycle.

1. The first argument contains the raw `Buffer` data in the message
2. The second argument contains a `state` object that you can use to identify where the protocol is at in its lifecycle. The object includes:
   - `hasStarted`: Whether or not a `StartupMessage` has been sent by the client. This is the initial starting point in the protocol.
   - `isAuthenticated`: Whether or not authentication has completed

The callback should return `true` to indicate that you have handled the message response yourself and that no further processing should be done. Returning `false` will result in further processing by the `PostgresConnection`.

```typescript
const connection = new PostgresConnection(socket, {
  async onMessage(data, { hasStarted, isAuthenticated }) {
    // Handle raw messages yourself

    return false;
  },
});
```

See [PGlite](#pglite) for an example on how you might use this.

## Examples

### PGlite

[PGlite](https://github.com/electric-sql/pglite) is a WASM build of Postgres that can run in-browser or server-side. Under the hood, PGlite uses Postgres' single-user mode which skips standard startup/auth messages in the protocol and operates outside of a TCP connection.

With `pg-gateway`, we can serve PGlite over TCP by handling the startup/auth ourselves, then forward future messages to PGlite:

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

## Development

```shell
npm run dev
```

## License

MIT
