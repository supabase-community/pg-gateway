/**
 * Message Types
 *
 * These are the backend (B) message types as defined in the PostgreSQL protocol.
 *
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html
 */
export const MessageType = {
  /** Authentication Request ('R') */
  AuthenticationRequest: 82,
  /** Backend Key Data ('K') */
  BackendKeyData: 75,
  /** Bind Complete ('2') */
  BindComplete: 50,
  /** Close Complete ('3') */
  CloseComplete: 51,
  /** Command Complete ('C') */
  CommandComplete: 67,
  /** Data Row ('D') */
  DataRow: 68,
  /** Empty Query Response ('I') */
  EmptyQueryResponse: 73,
  /** Error Response ('E') */
  ErrorResponse: 69,
  /** Function Call Response ('V') */
  FunctionCallResponse: 86,
  /** Negotiate Protocol Version ('v') */
  NegotiateProtocolVersion: 118,
  /** No Data ('n') */
  NoData: 110,
  /** Notice Response ('N') */
  NoticeResponse: 78,
  /** Notification Response ('A') */
  NotificationResponse: 65,
  /** Parameter Description ('t') */
  ParameterDescription: 116,
  /** Parameter Status ('S') */
  ParameterStatus: 83,
  /** Parse Complete ('1') */
  ParseComplete: 49,
  /** Portal Suspended ('s') */
  PortalSuspended: 115,
  /** Ready For Query ('Z') */
  ReadyForQuery: 90,
  /** Row Description ('T') */
  RowDescription: 84,
  /** Copy Data ('d') */
  CopyData: 100,
  /** Copy Done ('c') */
  CopyDone: 99,
  /** Copy In Response ('G') */
  CopyInResponse: 71,
  /** Copy Out Response ('H') */
  CopyOutResponse: 72,
  /** Copy Both Response ('W') */
  CopyBothResponse: 87,
} as const;
