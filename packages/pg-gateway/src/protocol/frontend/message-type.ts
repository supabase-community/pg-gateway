/**
 * Frontend Message Types
 *
 * These are the frontend (F) message types as defined in the PostgreSQL protocol.
 *
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html
 */
export const MessageType = {
  /** Bind ('B') */
  Bind: 66,
  /** Close ('C') */
  Close: 67,
  /** Describe ('D') */
  Describe: 68,
  /** Execute ('E') */
  Execute: 69,
  /** Flush ('H') */
  Flush: 72,
  /** Function Call ('F') */
  FunctionCall: 70,
  /** Parse ('P') */
  Parse: 80,
  /** Query ('Q') */
  Query: 81,
  /** Sync ('S') */
  Sync: 83,
  /** Terminate ('X') */
  Terminate: 88,
  /** Password Message ('p') */
  PasswordMessage: 112,
  /** GSSAPI Response ('p') */
  GSSResponse: 112,
  /** SASL Initial Response ('p') */
  SASLInitialResponse: 112,
  /** SASL Response ('p') */
  SASLResponse: 112,
  /** Copy Data ('d') */
  CopyData: 100,
  /** Copy Done ('c') */
  CopyDone: 99,
  /** Copy Fail ('f') */
  CopyFail: 102,
} as const;
