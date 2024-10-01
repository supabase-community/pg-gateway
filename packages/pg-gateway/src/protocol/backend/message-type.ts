export const MessageType = {
  AuthenticationRequest: 'R'.charCodeAt(0),
  BackendKeyData: 'K'.charCodeAt(0),
  BindComplete: '2'.charCodeAt(0),
  CloseComplete: '3'.charCodeAt(0),
  CommandComplete: 'C'.charCodeAt(0),
  DataRow: 'D'.charCodeAt(0),
  EmptyQueryResponse: 'I'.charCodeAt(0),
  ErrorResponse: 'E'.charCodeAt(0),
  FunctionCallResponse: 'V'.charCodeAt(0),
  NegotiateProtocolVersion: 'v'.charCodeAt(0),
  NoData: 'n'.charCodeAt(0),
  NoticeResponse: 'N'.charCodeAt(0),
  NotificationResponse: 'A'.charCodeAt(0),
  ParameterDescription: 't'.charCodeAt(0),
  ParameterStatus: 'S'.charCodeAt(0),
  ParseComplete: '1'.charCodeAt(0),
  PortalSuspended: 's'.charCodeAt(0),
  ReadyForQuery: 'Z'.charCodeAt(0),
  RowDescription: 'T'.charCodeAt(0),
  CopyData: 'd'.charCodeAt(0),
  CopyDone: 'c'.charCodeAt(0),
  CopyInResponse: 'G'.charCodeAt(0),
  CopyOutResponse: 'H'.charCodeAt(0),
  CopyBothResponse: 'W'.charCodeAt(0),
} as const;
