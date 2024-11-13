import { AuthenticationRequestType } from './authentication-request-type';
import { MessageType } from '../message-type';

/**
 * Creates an AuthenticationSASLContinue message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONSASLCONTINUE
 */
export function createAuthenticationSASLContinue(saslData: Uint8Array): Uint8Array {
  const messageLength = 8 + saslData.length; // 4 bytes for length + 4 bytes for auth type + SASL data
  const buffer = new ArrayBuffer(1 + messageLength); // 1 byte for type + message length
  const view = new DataView(buffer);

  // Byte1('R') - Identifies the message as an authentication request
  view.setUint8(0, MessageType.AuthenticationRequest);

  // Int32 - Length of message contents in bytes, including self
  view.setUint32(1, messageLength);

  // Int32(11) - Specifies that this message contains a SASL challenge
  view.setUint32(5, AuthenticationRequestType.SASLContinue);

  // Byte_n - SASL data, specific to the SASL mechanism being used
  new Uint8Array(buffer, 9).set(saslData);

  return new Uint8Array(buffer);
}

/**
 * Parses an AuthenticationSASLContinue message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONSASLCONTINUE
 */
export function parseAuthenticationSASLContinue(message: Uint8Array): {
  type: typeof MessageType.AuthenticationRequest;
  authenticationRequestType: typeof AuthenticationRequestType.SASLContinue;
  saslData: Uint8Array;
} {
  if (message.length < 9) {
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
  if (authenticationRequestType !== AuthenticationRequestType.SASLContinue) {
    throw new Error(`Invalid authentication request type: ${authenticationRequestType}`);
  }

  // Extract SASL data
  const saslData = new Uint8Array(message.buffer, message.byteOffset + 9);

  return {
    type: MessageType.AuthenticationRequest,
    authenticationRequestType: AuthenticationRequestType.SASLContinue,
    saslData,
  };
}

/**
 * Checks if a message is an AuthenticationSASLContinue message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONSASLCONTINUE
 */
export function isAuthenticationSASLContinue(message: Uint8Array): boolean {
  if (message.length < 9) {
    return false;
  }
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  return (
    view.getUint8(0) === MessageType.AuthenticationRequest &&
    view.getInt32(5) === AuthenticationRequestType.SASLContinue
  );
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('AuthenticationSASLContinue', () => {
    const saslData = new Uint8Array([1, 2, 3, 4]);
    const message = createAuthenticationSASLContinue(saslData);
    expect(isAuthenticationSASLContinue(message)).toBe(true);
    const parsed = parseAuthenticationSASLContinue(message);
    expect(parsed).toEqual({
      type: MessageType.AuthenticationRequest,
      authenticationRequestType: AuthenticationRequestType.SASLContinue,
      saslData,
    });
  });
}
