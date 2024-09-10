import { spawn, type StdioOptions } from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';

async function readStream(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function execOpenSSL(args: string[], fds: { [key: string]: Buffer } = {}) {
  const stdio: StdioOptions = [
    'pipe',
    'pipe',
    'pipe',
    ...Object.keys(fds).map(() => 'pipe' as const),
  ];

  const child = spawn('openssl', args, { stdio });

  Object.values(fds).forEach((data, index) => {
    // Pipe from index 3 for additional file descriptors
    const fd = index + 3;

    const writeStream = child.stdio[fd];

    if (!writeStream) {
      throw new Error(`OpenSSL file descriptor ${fd} not available`);
    }

    if (!('writable' in writeStream) || !writeStream.writable) {
      throw new Error(`OpenSSL file descriptor ${fd} not writable`);
    }

    Readable.from([data]).pipe(writeStream);
  });

  if (!child.stdout || !child.stderr) {
    throw new Error('OpenSSL process failed to create stdout/stderr');
  }

  const [stdout, stderr, [exitCode]] = await Promise.all([
    readStream(child.stdout),
    readStream(child.stderr),
    once(child, 'close'),
  ]);

  if (exitCode !== 0) {
    throw new Error(`OpenSSL process exited with code ${exitCode}. ${stderr}`);
  }

  return [stdout, stderr];
}

async function generateCA(subject: string) {
  const [caKey] = await execOpenSSL(['genpkey', '-algorithm', 'RSA']);
  const [caCert] = await execOpenSSL(
    ['req', '-new', '-x509', '-key', '/dev/fd/3', '-days', '365', '-subj', subject],
    { '3': caKey },
  );
  return { caKey: new Uint8Array(caKey), caCert: new Uint8Array(caCert) };
}

async function generateCSR(subject: string) {
  const [key] = await execOpenSSL(['genpkey', '-algorithm', 'RSA']);
  const [csr] = await execOpenSSL(['req', '-new', '-key', '/dev/fd/3', '-subj', subject], {
    '3': key,
  });
  return { key: new Uint8Array(key), csr: new Uint8Array(csr) };
}

async function signCert(caCert: Uint8Array, caKey: Uint8Array, csr: Uint8Array) {
  const [cert] = await execOpenSSL(
    ['x509', '-req', '-in', '/dev/fd/3', '-CA', '/dev/fd/4', '-CAkey', '/dev/fd/5', '-days', '365'],
    {
      '3': Buffer.from(csr),
      '4': Buffer.from(caCert),
      '5': Buffer.from(caKey),
    },
  );
  return new Uint8Array(cert);
}

export async function generateAllCertificates() {
  const { caKey, caCert } = await generateCA('/CN=My Root CA');

  const { key: serverKey, csr: serverCsr } = await generateCSR('/CN=localhost');
  const serverCert = await signCert(caCert, caKey, serverCsr);

  const { key: clientKey, csr: clientCsr } = await generateCSR('/CN=postgres');
  const clientCert = await signCert(caCert, caKey, clientCsr);

  return {
    caKey,
    caCert,
    serverKey,
    serverCert,
    clientKey,
    clientCert,
  };
}
