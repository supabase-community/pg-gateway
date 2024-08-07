import type { CertAuthOptions } from './cert';
import type { Md5AuthOptions } from './md5';
import type { PasswordAuthOptions } from './password';
import type { ScramSha256AuthOptions } from './sasl/scram-sha-256';
import type { TrustAuthOptions } from './trust';

export type AuthOptions =
  | TrustAuthOptions
  | PasswordAuthOptions
  | Md5AuthOptions
  | ScramSha256AuthOptions
  | CertAuthOptions;
