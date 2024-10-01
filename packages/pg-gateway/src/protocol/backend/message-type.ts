/**
 * Message Types
 *
 * These are the backend (B) message types as defined in the PostgreSQL protocol.
 *
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html
 */
export const MessageType = {
  AuthenticationRequest: 'R',
  BackendKeyData: 'K',
  BindComplete: '2',
  CloseComplete: '3',
  CommandComplete: 'C',
  DataRow: 'D',
  EmptyQueryResponse: 'I',
  ErrorResponse: 'E',
  FunctionCallResponse: 'V',
  NegotiateProtocolVersion: 'v',
  NoData: 'n',
  NoticeResponse: 'N',
  NotificationResponse: 'A',
  ParameterDescription: 't',
  ParameterStatus: 'S',
  ParseComplete: '1',
  PortalSuspended: 's',
  ReadyForQuery: 'Z',
  RowDescription: 'T',
  CopyData: 'd',
  CopyDone: 'c',
  CopyInResponse: 'G',
  CopyOutResponse: 'H',
  CopyBothResponse: 'W',
} as const;
