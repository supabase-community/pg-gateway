import { encodeBase64 } from '@std/encoding/base64';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

const { crypto } = globalThis;
const { subtle } = crypto;

pkijs.setEngine('web-crypto', new pkijs.CryptoEngine({ crypto }));

export function toPEM(
  data: ArrayBuffer | Uint8Array,
  type: 'CERTIFICATE' | 'PRIVATE KEY' | 'CERTIFICATE REQUEST',
): string {
  const base64String = encodeBase64(data);

  // Chunk into 64-character lines
  const lines = base64String.match(/.{1,64}/g) ?? [];

  const header = `-----BEGIN ${type}-----`;
  const footer = `-----END ${type}-----`;

  return [header, ...lines, footer].join('\n');
}

export async function generateKeyPair() {
  return subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
}

export async function generateCA(CN: string) {
  const { publicKey, privateKey } = await generateKeyPair();

  const certificate = new pkijs.Certificate();

  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: Date.now() });
  certificate.issuer = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: '2.5.4.3', // Common Name
        value: new asn1js.PrintableString({ value: CN }),
      }),
    ],
  });
  certificate.subject = certificate.issuer;
  certificate.notBefore.value = new Date();
  certificate.notAfter.value = new Date();
  certificate.notAfter.value.setFullYear(certificate.notBefore.value.getFullYear() + 1);

  await certificate.subjectPublicKeyInfo.importKey(publicKey);

  certificate.extensions = [
    new pkijs.Extension({
      extnID: '2.5.29.19', // Basic Constraints
      critical: true,
      extnValue: new asn1js.OctetString({
        valueHex: new pkijs.BasicConstraints({ cA: true }).toSchema().toBER(false),
      }).valueBlock.valueHex,
    }),
  ];

  await certificate.sign(privateKey, 'SHA-256');

  const caCert = certificate.toSchema(true).toBER(false);
  const caKey = await subtle.exportKey('pkcs8', privateKey);

  return { caKey, caCert };
}

export async function generateCSR(CN: string) {
  const { publicKey, privateKey } = await generateKeyPair();

  const request = new pkijs.CertificationRequest();

  request.version = 0;
  request.subject.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: '2.5.4.3', // OID for Common Name (CN)
      value: new asn1js.PrintableString({ value: CN }),
    }),
  );

  await request.subjectPublicKeyInfo.importKey(publicKey);
  await request.sign(privateKey, 'SHA-256');

  const key = await subtle.exportKey('pkcs8', privateKey);
  const csr = request.toSchema().toBER(false);

  return { key, csr };
}

export async function signCert(caCert: ArrayBuffer, caKey: ArrayBuffer, csr: ArrayBuffer) {
  const caPrivateKey = await subtle.importKey(
    'pkcs8',
    caKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' },
    },
    true,
    ['sign'],
  );

  const caCertificate = new pkijs.Certificate({ schema: asn1js.fromBER(caCert).result });

  const request = new pkijs.CertificationRequest({ schema: asn1js.fromBER(csr).result });

  // Extract public key from CSR
  const publicKey = await subtle.importKey(
    'spki',
    request.subjectPublicKeyInfo.toSchema().toBER(false),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' },
    },
    true,
    ['verify'],
  );

  const certificate = new pkijs.Certificate();

  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: Date.now() });

  certificate.issuer = caCertificate.subject;
  certificate.subject = request.subject;

  certificate.notBefore.value = new Date();
  certificate.notAfter.value = new Date();
  certificate.notAfter.value.setFullYear(certificate.notBefore.value.getFullYear() + 1);

  await certificate.subjectPublicKeyInfo.importKey(publicKey);

  await certificate.sign(caPrivateKey, 'SHA-256');

  const certBytes = certificate.toSchema(true).toBER(false);

  return certBytes;
}

export async function generateAllCertificates() {
  const { caKey, caCert } = await generateCA('My Root CA');

  const { key: serverKey, csr: serverCsr } = await generateCSR('localhost');
  const serverCert = await signCert(caCert, caKey, serverCsr);

  const { key: clientKey, csr: clientCsr } = await generateCSR('postgres');
  const clientCert = await signCert(caCert, caKey, clientCsr);

  const encoder = new TextEncoder();

  return {
    caKey: encoder.encode(toPEM(caKey, 'PRIVATE KEY')),
    caCert: encoder.encode(toPEM(caCert, 'CERTIFICATE')),
    serverKey: encoder.encode(toPEM(serverKey, 'PRIVATE KEY')),
    serverCert: encoder.encode(toPEM(serverCert, 'CERTIFICATE')),
    clientKey: encoder.encode(toPEM(clientKey, 'PRIVATE KEY')),
    clientCert: encoder.encode(toPEM(clientCert, 'CERTIFICATE')),
  };
}
