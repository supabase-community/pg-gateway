import type { CertAuth } from './cert';
import type { Md5Auth } from './md5';
import type { PasswordAuth } from './password';
import type { ScramSha256Auth } from './scram-sha-256';
import type { TrustAuth } from './trust';

export type Auth =
  | TrustAuth
  | PasswordAuth
  | Md5Auth
  | ScramSha256Auth
  | CertAuth;
