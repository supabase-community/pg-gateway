import { MessageType } from './message-type';

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
  view.setUint32(5, 3);

  return new Uint8Array(buffer);
}

/**
 * Checks if a message is an AuthenticationCleartextPassword message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONCLEARTEXTPASSWORD
 */
export function isAuthenticationCleartextPassword(message: Uint8Array): boolean {
  // Check length
  if (message.length !== 9) {
    return false;
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);

  // Check message type
  const messageType = view.getUint8(0);
  if (messageType !== MessageType.AuthenticationRequest) {
    return false;
  }

  // Check message length
  const length = view.getInt32(1);
  if (length !== 8) {
    return false;
  }

  // Check authentication type
  const authType = view.getInt32(5);
  if (authType !== 3) {
    return false;
  }

  return true;
}

/**
 * Parses an AuthenticationCleartextPassword message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONCLEARTEXTPASSWORD
 */
export function parseAuthenticationCleartextPassword(message: Uint8Array): void {
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

  // Check authentication type
  const authType = view.getInt32(5);
  if (authType !== 3) {
    throw new Error(`Invalid authentication type: ${authType}`);
  }
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('AuthenticationCleartextPassword', () => {
    const message = createAuthenticationCleartextPassword();
    expect(isAuthenticationCleartextPassword(message)).toBe(true);
    expect(() => parseAuthenticationCleartextPassword(message)).not.toThrow();
  });
}