export type ClientParameters = {
  user: string;
  [key: string]: string;
};

export type TlsInfo = {
  serverName?: string;
  clientCertificate?: Uint8Array;
};

export const ServerStep = {
  AwaitingInitialMessage: 'AwaitingInitialMessage',
  PerformingAuthentication: 'PerformingAuthentication',
  ReadyForQuery: 'ReadyForQuery',
} as const;

export type ServerStep = (typeof ServerStep)[keyof typeof ServerStep];

export type ConnectionState = {
  hasStarted: boolean;
  isAuthenticated: boolean;
  clientParams?: ClientParameters;
  tlsInfo?: TlsInfo;
  step: ServerStep;
};
