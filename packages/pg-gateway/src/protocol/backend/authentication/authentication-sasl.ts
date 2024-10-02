import { AuthenticationRequestType } from './authentication-request-type';
import { MessageType } from '../message-type';

/**
 * Creates an AuthenticationSASL message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONSASL
 */
export function createAuthenticationSASL(mechanisms: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const mechanismsBuffer = mechanisms
    .map((m) => encoder.encode(`${m}\0`))
    // biome-ignore lint/performance/noAccumulatingSpread: <explanation>
    .reduce((a, b) => new Uint8Array([...a, ...b]));
  const messageLength = 8 + mechanismsBuffer.length; // 4 bytes for length + 4 bytes for auth type + mechanisms
  const buffer = new ArrayBuffer(1 + messageLength); // 1 byte for type + message length
  const view = new DataView(buffer);

  // Byte1('R') - Identifies the message as an authentication request
  view.setUint8(0, MessageType.AuthenticationRequest);

  // Int32 - Length of message contents in bytes, including self
  view.setUint32(1, messageLength);

  // Int32(10) - Specifies that SASL authentication is required
  view.setUint32(5, AuthenticationRequestType.SASL);

  // String - List of SASL authentication mechanisms
  new Uint8Array(buffer, 9).set(mechanismsBuffer);

  return new Uint8Array(buffer);
}

/**
 * Parses an AuthenticationSASL message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONSASL
 */
export function parseAuthenticationSASL(message: Uint8Array): {
  type: typeof MessageType.AuthenticationRequest;
  authenticationRequestType: typeof AuthenticationRequestType.SASL;
  mechanisms: string[];
} {
  if (message.length < 10) {
    throw new Error(`Invalid length: ${message.length}`);
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);

  // Check message type
  const messageType = view.getUint8(0);
  if (messageType !== MessageType.AuthenticationRequest) {
    throw new Error(`Invalid message type: ${messageType}`);
  }

  // Check message length
  const length = view.getInt32(1);
  if (length !== message.length - 1) {
    throw new Error(`Invalid message length: ${length}`);
  }

  // Check authentication request type
  const authenticationRequestType = view.getInt32(5);
  if (authenticationRequestType !== AuthenticationRequestType.SASL) {
    throw new Error(`Invalid authentication request type: ${authenticationRequestType}`);
  }

  // Parse mechanisms
  const mechanismsBuffer = new Uint8Array(message.buffer, message.byteOffset + 9);
  const decoder = new TextDecoder();
  const mechanisms = decoder
    .decode(mechanismsBuffer)
    .split('\0')
    .filter((m) => m.length > 0);

  return {
    type: MessageType.AuthenticationRequest,
    authenticationRequestType: AuthenticationRequestType.SASL,
    mechanisms,
  };
}

/**
 * Checks if a message is an AuthenticationSASL message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONSASL
 */
export function isAuthenticationSASL(message: Uint8Array): boolean {
  try {
    parseAuthenticationSASL(message);
    return true;
  } catch (error) {
    return false;
  }
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('AuthenticationSASL', () => {
    const mechanisms = ['SCRAM-SHA-256', 'SCRAM-SHA-256-PLUS'];
    const message = createAuthenticationSASL(mechanisms);
    expect(isAuthenticationSASL(message)).toBe(true);
    const parsed = parseAuthenticationSASL(message);
    expect(parsed).toEqual({
      type: MessageType.AuthenticationRequest,
      authenticationRequestType: AuthenticationRequestType.SASL,
      mechanisms,
    });
  });
}
