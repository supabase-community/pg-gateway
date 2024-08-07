declare module 'pg/lib/crypto/sasl' {
  export type Session = {
    mechanism: 'SCRAM-SHA-256';
    clientNonce: string;
    response: string;
    message: string;
  };

  export function startSession(mechanisms: string[]): Session;
  export function continueSession(
    session: Session,
    password: string,
    serverData: string,
  ): Promise<void>;
  export function finalizeSession(session: Session, serverData: string): void;
}
