import { PassThrough, Readable, Writable } from 'node:stream';
import { TLSSocket, type TLSSocketOptions, createSecureContext } from 'node:tls';
import type { TlsOptions, TlsOptionsCallback } from '../../connection.js';
import type { TlsInfo } from '../../connection.types.js';
import type { Duplex } from '../../duplex.js';
import { nodeDuplexToWebDuplex, webDuplexToNodeDuplex } from './index.js';

export async function upgradeTls(
  duplex: Duplex<Uint8Array>,
  options: TlsOptions | TlsOptionsCallback,
  tlsInfo: TlsInfo = {},
  requestCert = false,
): Promise<{
  duplex: Duplex<Uint8Array>;
  tlsInfo: TlsInfo;
}> {
  const tlsSocketOptions = await createTlsSocketOptions(options, tlsInfo, requestCert);
  const nodeDuplex = await webDuplexToNodeDuplex(duplex);

  const secureSocket = new TLSSocket(nodeDuplex, {
    ...tlsSocketOptions,
    isServer: true,
    SNICallback: async (sniServerName, callback) => {
      tlsInfo.sniServerName = sniServerName;
      const updatedTlsSocketOptions = await createTlsSocketOptions(options, tlsInfo, requestCert);
      callback(null, createSecureContext(updatedTlsSocketOptions));
    },
  });

  await new Promise<void>((resolve) => {
    secureSocket.on('secure', () => {
      onServerSocketSecure(secureSocket);
      resolve();
    });
  });

  return {
    duplex: await nodeDuplexToWebDuplex(nodeDuplex),
    // clientCertificate: secureSocket.getPeerCertificate(),
    tlsInfo,
  };
}

async function createTlsSocketOptions(
  optionsOrCallback: TlsOptions | TlsOptionsCallback,
  tlsInfo: TlsInfo,
  requestCert: boolean,
): Promise<TLSSocketOptions> {
  const { key, cert, ca, passphrase } =
    typeof optionsOrCallback === 'function' ? await optionsOrCallback(tlsInfo) : optionsOrCallback;

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
