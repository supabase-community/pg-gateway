import { AuthenticationRequestType } from './authentication-request-type';
import { MessageType } from '../message-type';

/**
 * Creates an AuthenticationGSS message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONGSS
 */
export function createAuthenticationGSS(): Uint8Array {
  const messageLength = 8; // 4 bytes for length + 4 bytes for auth type
  const buffer = new ArrayBuffer(1 + messageLength); // 1 byte for type + message length
  const view = new DataView(buffer);

  // Byte1('R') - Identifies the message as an authentication request
  view.setUint8(0, MessageType.AuthenticationRequest);

  // Int32 - Length of message contents in bytes, including self
  view.setUint32(1, messageLength);

  // Int32(7) - Specifies that GSSAPI authentication is required
  view.setUint32(5, AuthenticationRequestType.GSS);

  return new Uint8Array(buffer);
}

/**
 * Parses an AuthenticationGSS message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONGSS
 */
export function parseAuthenticationGSS(message: Uint8Array): {
  type: typeof MessageType.AuthenticationRequest;
  authenticationRequestType: typeof AuthenticationRequestType.GSS;
} {
  if (message.length !== 9) {
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
  if (length !== 8) {
    throw new Error(`Invalid message length: ${length}`);
  }

  // Check authentication request type
  const authenticationRequestType = view.getInt32(5);
  if (authenticationRequestType !== AuthenticationRequestType.GSS) {
    throw new Error(`Invalid authentication request type: ${authenticationRequestType}`);
  }

  return {
    type: MessageType.AuthenticationRequest,
    authenticationRequestType: AuthenticationRequestType.GSS,
  };
}

/**
 * Checks if a message is an AuthenticationGSS message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONGSS
 */
export function isAuthenticationGSS(message: Uint8Array): boolean {
  try {
    parseAuthenticationGSS(message);
    return true;
  } catch (error) {
    return false;
  }
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('AuthenticationGSS', () => {
    const message = createAuthenticationGSS();
    expect(isAuthenticationGSS(message)).toBe(true);
    const parsed = parseAuthenticationGSS(message);
    expect(parsed).toEqual({
      type: MessageType.AuthenticationRequest,
      authenticationRequestType: AuthenticationRequestType.GSS,
    });
  });
}
