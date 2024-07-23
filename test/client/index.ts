import { Socket } from 'net';
import { serialize } from 'pg-protocol';
import { Parser } from 'pg-protocol/dist/parser';
import {
  continueSession,
  finalizeSession,
  Session,
  startSession,
} from 'pg/lib/crypto/sasl';

const client = new Socket();
let saslSession: Session;
const parser = new Parser();

client.connect(54321, 'localhost', () => {
  const data = serialize.startup({ user: 'postgres' });
  client.write(data);
});

client.on('data', (data) => {
  parser.parse(data, async (msg) => {
    console.log(msg);

    switch (msg.name) {
      case 'authenticationSASL': {
        const { mechanisms }: { mechanisms: string[] } = msg as any;
        saslSession = startSession(mechanisms);
        const data = serialize.sendSASLInitialResponseMessage(
          saslSession.mechanism,
          saslSession.response
        );
        client.write(data);
        return;
      }
      case 'authenticationSASLContinue': {
        const { data }: { data: string } = msg as any;
        await continueSession(saslSession, 'postgress', data);
        const responseData = serialize.sendSCRAMClientFinalMessage(
          saslSession.response
        );
        client.write(responseData);
        return;
      }
      case 'authenticationSASLFinal': {
        const { data }: { data: string } = msg as any;
        finalizeSession(saslSession, data);
        return;
      }
    }
  });
});
