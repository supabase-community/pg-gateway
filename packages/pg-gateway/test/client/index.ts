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

client.connect(2345, 'localhost', () => {
  const data = serialize.startup({ user: 'postgres' });
  client.write(data);
});

client.on('data', (data) => {
  parser.parse(data, async (msg) => {
    console.log('received message:', msg);

    switch (msg.name) {
      case 'authenticationSASL': {
        const { mechanisms }: { mechanisms: string[] } = msg as any;
        saslSession = startSession(mechanisms);
        const data = serialize.sendSASLInitialResponseMessage(
          saslSession.mechanism,
          saslSession.response
        );
        console.log('Sending SASL initial response:', data.toString('hex'));
        client.write(data);
        return;
      }
      case 'authenticationSASLContinue': {
        const { data }: { data: string } = msg as any;
        await continueSession(saslSession, 'postgres', data);
        const responseData = serialize.sendSCRAMClientFinalMessage(
          saslSession.response
        );
        console.log('Sending SASL continue response:', responseData.toString('hex'));
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