# pg-gateway

TypeScript library that implements the Postgres wire protocol from the server-side. It provides APIs you can hook into to handle authentication requests, queries, and other client messages yourself.

## Why?

This acts as a layer in front of your Postgres database (or any other database). You could use it for:

- Serving [PGlite](#pglite) over TCP
- Serving a non-Postgres database via the Postgres wire protocol
- Adding a [reverse proxy](#reverse-proxy-using-sni) in front of your databases
- Creating a custom connection pooler

## Features

- **Cross platform:** Built on web standards, so works in Node.js, Deno, Bun, and even the browser
- **Authentication:** Supports multiple auth methods including `trust`, `password`, `md5`, `scram-sha-256`, and `cert`
- **TLS encryption:** Handles standard TLS (SSL) upgrades with SNI support (useful for [reverse proxying](#reverse-proxy-using-sni))
- **Modular:** You control the server while the library manages the protocol
- **Hooks:** Hook into various points in the protocol's lifecycle (auth, query, etc)
- **Escape hatch:** Access the raw protocol messages at any point in the lifecycle
- **Examples:** Various examples on how you might use this library

## Usage

_This library is pre-1.0 so expect some breaking changes to the API over time._

This library is designed to give you as much control as possible while still managing the protocol lifecycle.

Start by creating your own TCP server, then pass each incoming stream into a `PostgresConnection`:

### Node.js

```typescript
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fromNodeSocket } from 'pg-gateway/node';

// Create a TCP server and listen for connections
const server = createServer(async (socket) => {
  // Returns a `PostgresConnection` which manages the protocol lifecycle
  const connection = await fromNodeSocket(socket);
});

// Listen on the desired port
server.listen(5432);
await once(server, 'listening');
console.log('Server listening on port 5432');
```

### Deno

```typescript
import { fromDenoConn } from 'npm:pg-gateway/deno';

// Create a TCP server and listen for connections
for await (const conn of Deno.listen({ port: 5432 })) {
  // Returns a `PostgresConnection` which manages the protocol lifecycle
  const connection = await fromDenoConn(conn);
}
```

### Browser / Other

Under the hood `fromNodeSocket()` and `fromDenoConn()` wrap a `new PostgresConnection()` which accepts a standard web duplex stream:

```typescript
interface DuplexStream<T = unknown> {
  readable: ReadableStream<T>;
  writable: WritableStream<T>;
}

const duplex: DuplexStream<Uint8Array> = ...

const connection = new PostgresConnection(duplex);
```

So as long as you have a `ReadableStream` and `WritableStream` that represent two sides of a bidirectional channel, it will work with pg-gateway.

> [`WebSocketStream`](https://developer.chrome.com/docs/capabilities/web-apis/websocketstream) is an example of a `DuplexStream` that could be useful here. Unfortunately `WebSocketStream` (as opposed to `WebSocket`) is still a Web API proposal and only implemented in Chromium-based browsers (ie. Chrome and Edge). Polyfills are possible, but they lack back-pressure which means in-memory buffers are unbounded.

There is also a utility function `createDuplexPair()` that will create a pair of linked duplex streams in-memory:

```typescript
import { createDuplexPair } from 'pg-gateway';

const [clientDuplex, serverDuplex] = createDuplexPair<Uint8Array>();
const connection = new PostgresConnection(serverDuplex);

// read and write to `clientDuplex` to talk to the server
```

This is useful if you had a browser-based Postgres client that can work with `ReadableStream` and `WritableStream` (see [PG browser test](./packages/pg-gateway/test/browser/pg.test.ts)). You could also use this within tests if, for example, you wanted to use PGlite as your database and you didn't want to spin up an actual TCP server (see [PG Node test](./packages/pg-gateway/test/node/pg.test.ts)).

## Options

`PostgresConnection` (as well as `fromNodeSocket` and `fromDenoConn`) expose a number of options and hooks as their second argument:

### `serverVersion`

Specifies the version of the server to return back to the client. Can include any arbitrary string.

```typescript
const connection = new PostgresConnection(duplex, {
  serverVersion: '16.3 (MyCustomPG)',
});
```

### `auth`

Specifies auth configuration, including which auth method you wish to use with clients and the corresponding callback to validate credentials. Auth methods are identical to those used in [`pg_hba.conf`](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html). Current methods supported are:

- `trust`: No password is requested. Client will be immediately authenticate after startup. This is the default method if unspecified.

  ```typescript
  const connection = new PostgresConnection(duplex, {
    auth: {
      method: 'trust',
    },
  });
  ```

- `password`: Password is sent in clear text by the client. Least secure password option.

  ```typescript
  const connection = new PostgresConnection(duplex, {
    auth: {
      method: 'password',
      async getClearTextPassword({ username }, state) {
        // Return the clear text password based on username
        return 'my-password';
      },
    },
  });
  ```

- `md5`: Password is hashed using Postgres' [nested MD5 algorithm](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-START-UP) before it is sent to the server.

  ```typescript
  const connection = new PostgresConnection(duplex, {
    auth: {
      method: 'md5',
      async getPreHashedPassword({ username }, state) {
        // Return the hashed password based on username
        return await fetchPreHashedPassword(username);
      },
    },
  });
  ```

  A `createPreHashedPassword()` function is available to help generate this pre-hashed password for a new user. It accepts 2 arguments:

  1. `username`: The username used to generate the hash
  2. `password`: The password used to generate the hash

  You would typically call this when you first create a user and then store it in a database:

  ```typescript
  import { createPreHashedPassword } from 'pg-gateway';

  // Call this when you first create your user and
  // store it in a DB
  const preHashedPassword = await createPreHashedPassword(
    'my-user',
    'my-password'
  );
  ```

  It will produce a `string` containing the md5-hashed password.

- `scram-sha-256`: A challenge-response scheme that stores passwords in a cryptographically hashed form according to [RFC 7677](https://datatracker.ietf.org/doc/html/rfc7677). This is the most secure and recommended method by Postgres.

  ```typescript
  const connection = new PostgresConnection(duplex, {
    auth: {
      method: 'scram-sha-256',
      async getScramSha256Data({ username }, state) {
        // Return the auth data based on username
        return await fetchScramSha256Data(username);
      },
    },
  });
  ```

  A `createScramSha256Data()` function is available to help generate this auth data for a new user. It accepts 2 arguments:

  1. `password`: The password used to generate the auth data
  2. `iterations`: The number of iterations used by the crypto algorithm. Defaults to 4096.

  You would typically call this when you first create a user and then store it in a database:

  ```typescript
  import { createScramSha256Data } from 'pg-gateway';

  // Call this when you first create your user and
  // store the auth data in a DB
  const authData = await createScramSha256Data('my-password');
  ```

  It will produce a `ScramSha256Data` object that contains the following:

  - `salt`: `string`
  - `iterations`: `number`
  - `storedKey`: `string`
  - `serverKey`: `string`

- `cert`: A client TLS certificate is requested. It must be signed by a certificate authority (CA) known to the server (see [TLS](#tls)).

  By default, the cert's common name (CN) must match the `username` field to authenticate. You can override this behaviour by implementing [`validateCredentials()`](#validatecredentials-override) yourself.

  Requires a TLS connection.

  ```typescript
  const connection = new PostgresConnection(duplex, {
    auth: {
      method: 'cert',
    },
  });
  ```

#### `validateCredentials()` override

Every auth method also accepts a `validateCredentials()` callback as an escape hatch if you need to handle the comparison logic yourself:

```typescript
const connection = new PostgresConnection(duplex, {
  auth: {
    method: 'password',
    // This method is still required but may be ignored
    // depending on the auth method
    async getClearTextPassword() {
      return '';
    },
    async validateCredentials({ password }) {
      // Any uppercase password is allowed ¯\_(ツ)_/¯
      return password === password.toUpperCase();
    },
  },
});
```

Returning `true` indicates that the credentials are valid and `false` indicates that they are invalid. If the credentials are marked invalid, the server will close the connection with an error. The callback can be either synchronous or asynchronous.

1. The first argument is a `credentials` object that contains different properties based on the auth method:

   - `password`:

     - `username`: The username sent from the client
     - `password`: The password sent from the client
     - `clearTextPassword`: The password returned by `getClearTextPassword()`

   - `md5`:

     - `username`: The username sent from the client
     - `hashedPassword`: The hashed password sent from the client
     - `salt`: The one-time salt generated by the server for the auth handshake
     - `preHashedPassword`: The password returned by `getPreHashedPassword()`

   - `scram-sha-256`:

     - `authMessage`: The auth message sent as part of the `scram-sha-256` handshake
     - `clientProof`: The client proof sent as part of the `scram-sha-256` handshake
     - `username`: The username sent from the client
     - `scramSha256Data`: The auth data returned by `getScramSha256Data()`

   - `cert`:

     - `username`: The username sent from the client
     - `certificate`: The certificate sent from the client

   Note that `validateCredentials()` does not exist for `trust` authentication.

2. The second argument contains a [`state`](#state) object which holds connection information gathered so far and can be used to understand where the protocol is at in its lifecycle.

Use this only as an escape hatch if you need to perform custom validation logic. Note that algorithms like `scram-sha-256` require very specific checks to authenticate correctly (including `getScramSha256Data()` which is used multiple times in the auth handshake), so overriding `validateCredentials()` can result in weak or incorrect security.

### `tls`

Like the real Postgres server, TLS connections are established as an upgrade mechanism after the initial handshake (`SSLRequest` message from the client). Currently TLS only works in Node.js when using the `fromNodeSocket()` helper. Unfortunately Deno does not yet offer APIs to upgrade a TCP connection to TLS from the server side, so TLS is not yet supported there (but likely in the future).

The `tls` option is an object that contains the following:

- `key`: An `ArrayBuffer` containing the TLS private key in PEM format
- `cert`: A `ArrayBuffer` containing the TLS cert chain in PEM format. Includes the TLS cert followed by any intermediate certs (not including root CA).
- `ca`: A `ArrayBuffer` containing the certificate authority (CA) in PEM format. Optional - if omitted, the runtime's built-in CAs will be used.
- `passphrase` A `string` containing the passphrase for `key`. Optional - only needed if `key` is encrypted.

When this option is passed, the server will require a TLS connection with the client. If the client doesn't send an `SSLRequest` message, the server will close the connection with an error.

If this option is not passed, the server will respond to `SSLRequest` messages with a message stating that SSL is not supported. At that point, clients can decide whether or not they want to continue the connection over an unencrypted channel.

```typescript
const tls: TlsOptions = {
  key: readFileSync('server-key.pem'),
  cert: readFileSync('server-cert.pem'),
  ca: readFileSync('ca-cert.pem'),
};

const connection = new PostgresConnection(duplex, {
  tls,
});
```

The `tls` option can also accept a callback:

```typescript
const connection = new PostgresConnection(duplex, {
  tls: async (serverName) => {
    return await getCertsForServer(serverName);
  },
});
```

Use this to dynamically return `TlsOptions` based on the [SNI server name](#reverse-proxy-using-sni) sent from the client.

### `onTlsUpgrade()`

This hook is called after the TLS upgrade has completed. It passes a [`state`](#state) argument which holds connection information gathered so far like `tlsInfo`. The callback can be either synchronous or asynchronous.

This will be called before the startup message is received from the frontend (if TLS is being used) so is a good place to establish [proxy connections](#reverse-proxy-using-sni) if desired. Note that a [`detach()`](#detach) method is also available if you wish to detach from the `PostgresConnection` after the proxy has been established.

```typescript
const tls: TlsOptions = {
  key: readFileSync('server-key.pem'),
  cert: readFileSync('server-cert.pem'),
  ca: readFileSync('ca-cert.pem'),
};

const connection = new PostgresConnection(duplex, {
  tls,
  async onTlsUpgrade({ tlsInfo }) {
    console.log({ tlsInfo });
  },
});
```

### `onStartup()`

This hook is called after the initial startup message has been received from the frontend. It passes a [`state`](#state) argument which holds connection information gathered so far like `clientInfo`. The callback can be either synchronous or asynchronous.

This is called after the connection is upgraded to TLS (if TLS is being used) but before authentication messages are sent to the frontend.

```typescript
const connection = new PostgresConnection(duplex, {
  async onStartup({ clientInfo }) {
    console.log({ clientInfo });
  },
});
```

### `onAuthenticated()`

This hook is called after a successful authentication has completed. It passes a [`state`](#state) argument which holds connection information gathered so far. The callback can be either synchronous or asynchronous.

```typescript
const connection = new PostgresConnection(duplex, {
  async onAuthenticated(state) {
    console.log(state);
  },
});
```

### `onMessage()`

This hook gives you access to raw messages at any point in the protocol lifecycle:

```typescript
const connection = new PostgresConnection(duplex, {
  async onMessage(data, state) {
    // Observe or handle raw messages yourself
  },
});
```

1. The first argument contains the raw `Uint8Array` data in the message
2. The second argument contains a [`state`](#state) object which holds connection information gathered so far and can be used to understand where the protocol is at in its lifecycle.

The callback can optionally return raw `Uint8Array` response data that will be sent back to the client:

```typescript
const connection = new PostgresConnection(duplex, {
  async onMessage(data, state) {
    return new Uint8Array(...);
  },
});
```

You can also return multiple `Uint8Array` responses via an `Iterable<Uint8Array>` or `AsyncIterable<Uint8Array>`. This means you can turn this hook into a generator function to asynchronously stream responses back to the client:

```typescript
const connection = new PostgresConnection(duplex, {
  async *onMessage(data, state) {
    yield new Uint8Array(...);;
    await new Promise((r) => setTimeout(r, 1000));
    yield new Uint8Array(...);;
  },
});
```

> **Warning:** By managing the message yourself (returning or yielding data), you bypass further processing by the `PostgresConnection` which means some state may not be collected and hooks won't be called depending on where the protocol is at in its lifecycle. If you wish to hook into messages without bypassing further processing, do not return any data from this callback. Alternatively if you wish to prevent further processing without returning any data, return `null`.

See [PGlite](#pglite) for an example on how you might use this.

### State

Over the course of the protocol lifecycle, `pg-gateway` will hold a `state` object that consists of various connection information gathered. Below are the properties available in `state`:

- `step`: the current step in the protocol lifecycle. Possible steps are:
  1. `AwaitingInitialMessage`
  2. `PerformingAuthentication`
  3. `ReadyForQuery`
- `hasStarted`: boolean indicating whether or not a startup message has been received by the client
- `isAuthenticated`: boolean indicating whether or not a successful authentication handshake has completed with the client
- `clientInfo`: object containing client information sent during startup.

  - `majorVersion`: `number`;
  - `minorVersion`: `number`;
  - `parameters`:
    - `user`: the user to connect to the database with
    - Any other arbitrary key-value pair (often `database` and run-time parameters). See [`StartupMessage`](https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-STARTUPMESSAGE) for more info.

  Note that `clientInfo` will be `undefined` until a startup message is received.

- `tlsInfo`: object containing TLS connection information (if TLS is being used).

  - `serverName`: string containing the [SNI](#reverse-proxy-using-sni) server name sent by the client. This can be `undefined` if the SNI extension was not used by the client.
  - `clientCertificate`: `Uint8Array` containing the raw client certificate in DER format. This will only exist during mutual TLS (mTLS) when the client sends a certificate via the `cert` auth method.

  Note that `tlsInfo` will be `undefined` until a TLS upgrade has completed.

State is available directly on the `PostgresConnection` instance:

```typescript
const connection = new PostgresConnection(duplex);
console.log(connection.state);
```

It is also passed as an argument to most hooks for convenience.

## `detach()`

A `detach()` method exists on the `PostgresConnection` to allow you to completely detach the stream from the `PostgresConnection` and handle all future data processing yourself. This is useful when [reverse proxying](#reverse-proxy-using-sni) to prevent the `PostgresConnection` from continuing to process each message after the proxy connection is established.

Calling `detach()` will return the current `DuplexStream` which may be different than the original duplex if a TLS upgrade occurred. The `PostgresConnection` will no longer buffer any data and no further processing will take place.

```typescript
const connection = new PostgresConnection(duplex);
const newDuplex = connection.detach();
```

## Examples

### PGlite

[PGlite](https://github.com/electric-sql/pglite) is a WASM build of Postgres that can run in-browser or server-side. Under the hood, PGlite uses Postgres' single-user mode which skips standard startup/auth messages in the protocol and operates outside of a TCP connection.

With `pg-gateway`, we can serve PGlite over TCP by handling the startup/auth ourselves, then forward future messages to PGlite:

```typescript
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:net';
import { fromNodeSocket } from 'pg-gateway/node';

const server = createServer(async (socket) => {
  // Each connection gets a fresh PGlite database,
  // since PGlite runs in single-user mode
  // (alternatively you could queue connections)
  const db = new PGlite();

  const connection = await fromNodeSocket(socket, {
    serverVersion: '16.3',

    auth: {
      // No password required
      method: 'trust',
    },

    async onStartup() {
      // Wait for PGlite to be ready before further processing
      await db.waitReady;
    },

    // Hook into each client message
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
```

You can test the connection using `psql`:

```shell
psql -h localhost -U postgres
```

You should immediately be brought into the `psql` REPL. At this point you are communicating directly with PGlite.

### Reverse Proxy using SNI

The [server name indication (SNI)](https://en.wikipedia.org/wiki/Server_Name_Indication) TLS extension allows clients to indicate which server hostname they intend to connect to when establishing an encrypted TLS connection. This is commonly used by HTTPS reverse proxies - without it, reverse proxies would be unable to identify which server to forward requests to since all messages are encrypted. You would need a separate IP/port pair for every server name you wish to connect to.

`pg-gateway` supports SNI with Postgres TLS connections to give you the same benefit. You can hook into the TLS upgrade step to retrieve the SNI server name sent by the client and use it to establish a reverse proxy connection to other Postgres servers, all over a single gateway IP/port.

In this example, clients will connect to `<id>.db.example.com` where `id` represents an arbitrary server ID we can use to look up the downstream Postgres host/port info. This implementation will terminate the TLS connection at the gateway, meaning the encrypted connections ends at the gateway and downstream data is proxied unencrypted.

We'll assume that the TLS cert used by the server has a wildcard for `*.db.example.com`, though if you wanted to send separate certs for each server, that is also supported (see below).

_index.ts_

```typescript
import { readFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { Duplex } from 'node:stream';
import type { TlsOptionsCallback } from 'pg-gateway';
import { fromNodeSocket } from 'pg-gateway/node';

const tls: TlsOptionsCallback = async (serverName) => {
  // Optionally serve different certs based on SNI `serverName`
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

const server = createServer(async (socket) => {
  const connection = await fromNodeSocket(socket, {
    tls,
    // This hook occurs before startup messages are received from the client,
    // so is a good place to establish proxy connections
    async onTlsUpgrade({ tlsInfo }) {
      if (!tlsInfo?.serverName) {
        return;
      }

      // In this example the left-most subdomain contains the server ID
      // ie. 12345.db.example.com -> 12345
      const [serverId] = tlsInfo.serverName.split('.');

      if (!serverId) {
        return;
      }

      // Lookup the server host/port based on ID
      const serverInfo = await getServerById(serverId);

      // Establish a TCP connection to the downstream server using the above host/port
      const proxySocket = connect(serverInfo);

      // Detach from the `PostgresConnection` to prevent further buffering/processing
      const duplex = await connection.detach();
      const nodeDuplex = Duplex.fromWeb(duplex);

      // Pipe data directly between sockets
      proxySocket.pipe(nodeDuplex);
      nodeDuplex.pipe(proxySocket);

      proxySocket.on('end', () => nodeDuplex.end());
      nodeDuplex.on('end', () => proxySocket.end());

      proxySocket.on('error', (err) => nodeDuplex.destroy(err));
      nodeDuplex.on('error', (err) => proxySocket.destroy(err));

      proxySocket.on('close', () => nodeDuplex.destroy());
      nodeDuplex.on('close', () => proxySocket.destroy());
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

To test this, we can create a self-signed certificate authority (CA) and cert. In production you could use a well known CA like Let's Encrypt.

Generate the certificates using OpenSSL:

1. **Generate the CA key and certificate:**

   ```bash
   openssl genpkey -algorithm RSA -out ca-key.pem
   openssl req -new -x509 -key ca-key.pem -out ca-cert.pem -days 365 -subj "/CN=MyCA"
   ```

2. **Generate the server key and CSR (Certificate Signing Request):**

   ```bash
   openssl genpkey -algorithm RSA -out server-key.pem
   openssl req -new -key server-key.pem -out server-csr.pem -subj "/CN=*.db.example.com"
   ```

3. **Sign the server certificate with the CA certificate:**
   ```bash
   openssl x509 -req -in server-csr.pem -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out server-cert.pem -days 365
   ```

Next we'll spin up a real Postgres server on `localhost` port `54321` using Docker:

```shell
docker run --rm -p 54321:5432 -e POSTGRES_PASSWORD=postgres postgres:16
```

This will act as our downstream server.

Next start the `pg-gateway` server:

```shell
npx tsx index.ts
```

Finally test the connection using `psql`:

```shell
psql "host=localhost port=5432 user=postgres sslmode=require"
```

You should be prompted for a password (`postgres`) and then brought into the `psql` REPL. At this point you are communicating with the downstream server through the reverse proxy. You can verify that you are connected to the downstream server by looking at the server version printed by `psql`:

```
psql (16.2, server 16.3 (Debian 16.3-1.pgdg120+1))
...
```

Note that we used `localhost` as the host which resulted in `serverName` being `localhost` instead of `12345.db.example.com`. To properly test this, you will need to pass the real host name:

```shell
psql "host=12345.db.example.com port=5432 user=postgres sslmode=required"
```

If you wanted to test this without deploying `pg-gateway` to a real server, you could modify your `/etc/hosts` file to point `12345.db.example.com` to your machine's loopback interface (acting like `localhost`):

_/etc/hosts_

```
# ...

127.0.0.1 12345.db.example.com
```

On Windows this file lives at `C:\Windows\System32\Drivers\etc\hosts`.

## License

MIT
