/**
 * Authentication Request Types
 *
 * These are the subtypes of the Authentication Request message (message type 'R')
 * as defined in the PostgreSQL protocol.
 *
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html
 */
export const AuthenticationRequestType = {
  Ok: 0,
  // 1 is not used
  KerberosV5: 2,
  CleartextPassword: 3,
  // 4 is not used
  MD5Password: 5,
  // 6 is not used
  GSS: 7,
  GSSContinue: 8,
  SSPI: 9,
  SASL: 10,
  SASLContinue: 11,
  SASLFinal: 12,
} as const;
