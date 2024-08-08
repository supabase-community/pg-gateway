export type ClientParameters = {
  user: string;
  [key: string]: string;
};

export type ClientInfo = {
  majorVersion: number;
  minorVersion: number;
  parameters: ClientParameters;
};

export type TlsInfo = {
  sniServerName?: string;
};

export type ConnectionState = {
  hasStarted: boolean;
  isAuthenticated: boolean;
  clientInfo?: ClientInfo;
  tlsInfo?: TlsInfo;
};
