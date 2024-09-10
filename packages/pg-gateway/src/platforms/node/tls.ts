import { X509Certificate } from 'node:crypto';
import { Duplex } from 'node:stream';
import { TLSSocket, type TLSSocketOptions, createSecureContext } from 'node:tls';
import type { TlsOptions, TlsOptionsCallback } from '../../connection.js';
import type { TlsInfo } from '../../connection.types.js';
import type { DuplexStream } from '../../streams.js';

export async function validateCredentials(credentials: {
  username: string;
  certificate: Uint8Array;
}) {
  const cert = new X509Certificate(Buffer.from(credentials.certificate));

  const subjectKeyValues: Record<string, string> = Object.fromEntries(
    cert.subject.split(/, ?/).map((entry) => entry.split('=')),
  );

  return 'CN' in subjectKeyValues && subjectKeyValues.CN === credentials.username;
}

export async function upgradeTls(
  duplex: DuplexStream<Uint8Array>,
  options: TlsOptions | TlsOptionsCallback,
  requestCert = false,
): Promise<{
  duplex: DuplexStream<Uint8Array>;
  tlsInfo: TlsInfo;
}> {
  const tlsInfo: TlsInfo = {};
  const tlsSocketOptions = await createTlsSocketOptions(options, requestCert);

  const nodeDuplex = Duplex.fromWeb(duplex);

  const secureSocket = new TLSSocket(nodeDuplex, {
    ...tlsSocketOptions,
    isServer: true,
    SNICallback: async (serverName, callback) => {
      tlsInfo.serverName = serverName;
      const updatedTlsSocketOptions = await createTlsSocketOptions(
        options,
        requestCert,
        serverName,
      );
      callback(null, createSecureContext(updatedTlsSocketOptions));
    },
  });

  await new Promise<void>((resolve) => {
    secureSocket.on('secure', () => {
      onServerSocketSecure(secureSocket);
      resolve();
    });
  });

  const peerCertificate = secureSocket.getPeerCertificate();

  if (peerCertificate) {
    tlsInfo.clientCertificate = new Uint8Array(peerCertificate.raw);
  }

  return {
    duplex: Duplex.toWeb(nodeDuplex),
    tlsInfo,
  };
}

async function createTlsSocketOptions(
  optionsOrCallback: TlsOptions | TlsOptionsCallback,
  requestCert: boolean,
  serverName?: string,
): Promise<TLSSocketOptions> {
  const { key, cert, ca, passphrase } =
    typeof optionsOrCallback === 'function'
      ? await optionsOrCallback(serverName)
      : optionsOrCallback;

  return {
    key: Buffer.from(key),
    cert: Buffer.from(cert),
    ca: ca ? Buffer.from(ca) : undefined,
    passphrase,
    requestCert,
  };
}

/**
 * Internal Node.js handler copied and modified from source to validate client certs.
 * https://github.com/nodejs/node/blob/aeaffbb385c9fc756247e6deaa70be8eb8f59496/lib/_tls_wrap.js#L1185-L1203
 *
 * Without this, `authorized` is always `false` on the TLSSocket and we never know if the client cert is valid.
 */
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function onServerSocketSecure(secureSocket: TLSSocket & any) {
  if (secureSocket._requestCert) {
    const verifyError = secureSocket._handle.verifyError();
    if (verifyError) {
      secureSocket.authorizationError = verifyError.code;
    } else {
      secureSocket.authorized = true;
    }
  }
}
