import { AuthenticationRequestType } from './authentication-request-type';
import { MessageType } from '../message-type';

/**
 * Creates an AuthenticationCleartextPassword message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONCLEARTEXTPASSWORD
 */
export function createAuthenticationCleartextPassword(): Uint8Array {
  const messageLength = 8; // 4 bytes for length + 4 bytes for auth type
  const buffer = new ArrayBuffer(1 + messageLength); // 1 byte for type + message length
  const view = new DataView(buffer);

  // Byte1('R') - Identifies the message as an authentication request
  view.setUint8(0, MessageType.AuthenticationRequest);

  // Int32 - Length of message contents in bytes, including self
  view.setUint32(1, messageLength);

  // Int32(3) - Specifies that cleartext password authentication is required
  view.setUint32(5, AuthenticationRequestType.CleartextPassword);

  return new Uint8Array(buffer);
}

/**
 * Parses an AuthenticationCleartextPassword message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONCLEARTEXTPASSWORD
 */
export function parseAuthenticationCleartextPassword(message: Uint8Array): {
  type: typeof MessageType.AuthenticationRequest;
  authenticationRequestType: typeof AuthenticationRequestType.CleartextPassword;
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
  if (authenticationRequestType !== AuthenticationRequestType.CleartextPassword) {
    throw new Error(`Invalid authentication request type: ${authenticationRequestType}`);
  }

  return {
    type: MessageType.AuthenticationRequest,
    authenticationRequestType: AuthenticationRequestType.CleartextPassword,
  };
}

/**
 * Checks if a message is an AuthenticationCleartextPassword message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONCLEARTEXTPASSWORD
 */
export function isAuthenticationCleartextPassword(message: Uint8Array): boolean {
  if (message.length < 9) {
    return false;
  }
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  return (
    view.getUint8(0) === MessageType.AuthenticationRequest &&
    view.getInt32(5) === AuthenticationRequestType.CleartextPassword
  );
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('AuthenticationCleartextPassword', () => {
    const message = createAuthenticationCleartextPassword();
    expect(isAuthenticationCleartextPassword(message)).toBe(true);
    const parsed = parseAuthenticationCleartextPassword(message);
    expect(parsed).toEqual({
      type: MessageType.AuthenticationRequest,
      authenticationRequestType: AuthenticationRequestType.CleartextPassword,
    });
  });
}
