import { Socket } from 'node:net';
import { serialize } from 'pg-protocol';
import { Parser } from 'pg-protocol/dist/parser';
import {
  type Session,
  continueSession,
  finalizeSession,
  startSession,
} from 'pg/lib/crypto/sasl';

const client = new Socket();
let saslSession: Session;
const parser = new Parser();

client.connect(2345, 'localhost', () => {
  const data = serialize.startup({ user: 'postgres' });
  client.write(data);
});

client.on('data', (data) => {
  parser.parse(data, async (msg) => {
    switch (msg.name) {
      case 'authenticationSASL': {
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const { mechanisms }: { mechanisms: string[] } = msg as any;
        saslSession = startSession(mechanisms);
        const data = serialize.sendSASLInitialResponseMessage(
          saslSession.mechanism,
          saslSession.response,
        );
        client.write(data);
        return;
      }
      case 'authenticationSASLContinue': {
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const { data }: { data: string } = msg as any;
        await continueSession(saslSession, 'postgres', data);
        const responseData = serialize.sendSCRAMClientFinalMessage(
          saslSession.response,
        );
        client.write(responseData);
        return;
      }
      case 'authenticationSASLFinal': {
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const { data }: { data: string } = msg as any;
        finalizeSession(saslSession, data);
        return;
      }
    }
  });
});
