# pg-gateway

TypeScript library that implements the Postgres wire protocol from the server-side. It provides APIs you can hook into to handle authentication requests, queries, and other client messages yourself.

## Why?

This acts as a layer in front of your Postgres database (or any other database). You could use it for:

- Serving [PGlite](#pglite) over TCP
- Serving a non-Postgres database via the Postgres wire protocol
- Adding a [reverse proxy](#reverse-proxy-using-sni) in front of your databases
- Creating a custom connection pooler

## Features

- **Authentication:** Supports multiple auth methods including `trust`, `password`, `md5`, `scram-sha-256`, and `cert`
- **TLS Encryption:** Handles standard TLS (SSL) upgrades with SNI support (useful for [reverse proxying](#reverse-proxy-using-sni))
- **Modular:** You control the server while the library manages the protocol
- **Hooks:** Hook into various points in the protocol's lifecycle (auth, query, etc)
- **Escape hatch:** Access the raw protocol messages at any point in the lifecycle
- **Examples:** Various examples on how you might use this library

## Usage

_This library is pre-1.0 so expect some breaking changes to the API over time._

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

### `auth`

Specifies auth configuration, including which auth method you wish to use with clients and the corresponding callback to validate credentials. Auth methods are identical to those used in [`pg_hba.conf`](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html). Current methods supported are:

- `trust`: No password is requested. Client will be immediately authenticate after startup. This is the default method if unspecified.

  ```typescript
  const connection = new PostgresConnection(socket, {
    auth: {
      method: 'trust',
    },
  });
  ```

- `password`: Password is sent in clear text by the client. Least secure password option.

  ```typescript
  const connection = new PostgresConnection(socket, {
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
  const connection = new PostgresConnection(socket, {
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
  const preHashedPassword = createPreHashedPassword('my-user', 'my-password');
  ```

  It will produce a `string` containing the md5-hashed password.

- `scram-sha-256`: A challenge-response scheme that stores passwords in a cryptographically hashed form according to [RFC 7677](https://datatracker.ietf.org/doc/html/rfc7677). This is the most secure and recommended method by Postgres.

  ```typescript
  const connection = new PostgresConnection(socket, {
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
  const authData = createScramSha256Data('my-password');
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
  const connection = new PostgresConnection(socket, {
    auth: {
      method: 'cert',
    },
  });
  ```

#### `validateCredentials()` override

Every auth method also accepts a `validateCredentials()` callback as an escape hatch if you need to handle the comparison logic yourself:

```typescript
const connection = new PostgresConnection(socket, {
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

The `tls` option can also accept a callback:

```typescript
const connection = new PostgresConnection(socket, {
  tls: async ({ sniServerName }) => {
    return await getCertsForServer(sniServerName);
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

const connection = new PostgresConnection(socket, {
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
const connection = new PostgresConnection(socket, {
  async onStartup({ clientInfo }) {
    console.log({ clientInfo });
  },
});
```

### `onAuthenticated()`

This hook is called after a successful authentication has completed. It passes a [`state`](#state) argument which holds connection information gathered so far. The callback can be either synchronous or asynchronous.

```typescript
const connection = new PostgresConnection(socket, {
  async onAuthenticated(state) {
    console.log(state);
  },
});
```

### `onMessage()`

This hook gives you access to raw messages at any point in the protocol lifecycle.

1. The first argument contains the raw `Buffer` data in the message
2. The second argument contains a [`state`](#state) object which holds connection information gathered so far and can be used to understand where the protocol is at in its lifecycle.

The callback should return `true` to indicate that you have handled the message response yourself and that no further processing should be done. Returning `false` will result in further processing by the `PostgresConnection`. The callback can be either synchronous or asynchronous.

> **Warning:** By managing the message yourself (returning `true`), you bypass further processing by the `PostgresConnection` which means some state may not be collected and hooks won't be called depending on where the protocol is at in its lifecycle.

```typescript
const connection = new PostgresConnection(socket, {
  async onMessage(data, { hasStarted, isAuthenticated }) {
    // Handle raw messages yourself

    return false;
  },
});
```

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

  - `sniServerName`: string containing the [SNI](#reverse-proxy-using-sni) server name sent by the client. This can be `undefined` if the SNI extension was not used by the client.

  Note that `tlsInfo` will be `undefined` until a TLS upgrade has completed.

State is available directly on the `PostgresConnection` instance:

```typescript
const connection = new PostgresConnection(socket);
console.log(connection.state);
```

It is also passed as an argument to most hooks for convenience.

## `detach()`

A `detach()` method exists on the `PostgresConnection` to allow you to completely detach the socket from the `PostgresConnection` and handle all future data processing yourself. This is useful when [reverse proxying](#reverse-proxy-using-sni) to prevent the `PostgresConnection` from continuing to process each message after the proxy connection is established.

Calling `detach()` will return the current `Socket` which may be different than the original socket if a TLS upgrade occurred (ie. a `TLSSocket`). The `PostgresConnection` will remove all event listeners from the socket and no further processing will take place.

```typescript
const connection = new PostgresConnection(socket);
const socket = connection.detach();
```

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

    auth: {
      // No password required
      method: 'trust',
    },

    async onStartup() {
      // Wait for PGlite to be ready before further processing
      await db.waitReady;
      return false;
    },

    // Hook into each client message
    async onMessage(data, { isAuthenticated }) {
      // Only forward messages to PGlite after authentication
      if (!isAuthenticated) {
        return false;
      }

      // Forward raw message to PGlite
      const responseData = await db.execProtocolRaw(data);
      connection.sendData(responseData);

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

You can test the connection using `psql`:

```shell
psql -h localhost -U postgres
```

You should be prompted for a password (`postgres`) and then brought into the `psql` REPL. At this point you are communicating directly with PGlite. You can verify that you are connected to PGlite by looking at the server version printed by `psql`:

```
psql (16.2, server 16.3 (PGlite 0.2.0))
...
```

_**Note:** the server version is only displayed by `psql` if it's different than the client version._

### Reverse Proxy using SNI

The [server name indication (SNI)](https://en.wikipedia.org/wiki/Server_Name_Indication) TLS extension allows clients to indicate which server hostname they intend to connect to when establishing an encrypted TLS connection. This is commonly used by HTTPS reverse proxies - without it, reverse proxies would be unable to identify which server to forward requests to since all messages are encrypted. You would need a separate IP/port pair for every server name you wish to connect to.

`pg-gateway` supports SNI with Postgres TLS connections to give you the same benefit. You can hook into the TLS upgrade step to retrieve the SNI server name sent by the client and use it to establish a reverse proxy connection to other Postgres servers, all over a single gateway IP/port.

In this example, clients will connect to `<id>.db.example.com` where `id` represents an arbitrary server ID we can use to look up the downstream Postgres host/port info. This implementation will terminate the TLS connection at the gateway, meaning the encrypted connections ends at the gateway and downstream data is proxied unencrypted.

We'll assume that the TLS cert used by the server has a wildcard for `*.db.example.com`, though if you wanted to send separate certs for each server, that is also supported (see below).

_index.ts_

```typescript
import { readFile } from 'node:fs/promises';
import net, { connect, Socket } from 'node:net';
import { PostgresConnection, TlsOptionsCallback } from 'pg-gateway';

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
          message: `ssl connection required`,
        });
        connection.socket.end();
        return;
      }

      if (!tlsInfo.sniServerName) {
        connection.sendError({
          severity: 'FATAL',
          code: '08000',
          message: `ssl sni extension required`,
        });
        connection.socket.end();
        return;
      }

      // In this example the left-most subdomain contains the server ID
      // ie. 12345.db.example.com -> 12345
      const [serverId] = tlsInfo.sniServerName.split('.');

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
psql "host=localhost port=5432 user=postgres sslmode=required"
```

You should be prompted for a password (`postgres`) and then brought into the `psql` REPL. At this point you are communicating with the downstream server through the reverse proxy. You can verify that you are connected to the downstream server by looking at the server version printed by `psql`:

```
psql (16.2, server 16.3 (Debian 16.3-1.pgdg120+1))
...
```

Note that we used `localhost` as the host which resulted in `sniServerName` being `localhost` instead of `12345.db.example.com`. To properly test this, you will need to pass the real host name:

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

## Development

```shell
npm run dev
```

## License

MIT
