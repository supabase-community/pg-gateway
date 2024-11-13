import { AuthenticationRequestType } from './authentication-request-type';
import { MessageType } from '../message-type';

/**
 * Creates an AuthenticationMD5Password message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONMD5PASSWORD
 */
export function createAuthenticationMD5Password(salt: Uint8Array): Uint8Array {
  if (salt.length !== 4) {
    throw new Error('Salt must be 4 bytes long');
  }

  const messageLength = 12; // 4 bytes for length + 4 bytes for auth type + 4 bytes for salt
  const buffer = new ArrayBuffer(1 + messageLength); // 1 byte for type + message length
  const view = new DataView(buffer);

  // Byte1('R') - Identifies the message as an authentication request
  view.setUint8(0, MessageType.AuthenticationRequest);

  // Int32 - Length of message contents in bytes, including self
  view.setUint32(1, messageLength);

  // Int32(5) - Specifies that an MD5-encrypted password is required
  view.setUint32(5, AuthenticationRequestType.MD5Password);

  // Byte4 - The salt to use when encrypting the password
  new Uint8Array(buffer, 9, 4).set(salt);

  return new Uint8Array(buffer);
}

/**
 * Parses an AuthenticationMD5Password message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONMD5PASSWORD
 */
export function parseAuthenticationMD5Password(message: Uint8Array): {
  type: typeof MessageType.AuthenticationRequest;
  authenticationRequestType: typeof AuthenticationRequestType.MD5Password;
  salt: Uint8Array;
} {
  if (message.length !== 13) {
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
  if (length !== 12) {
    throw new Error(`Invalid message length: ${length}`);
  }

  // Check authentication request type
  const authenticationRequestType = view.getInt32(5);
  if (authenticationRequestType !== AuthenticationRequestType.MD5Password) {
    throw new Error(`Invalid authentication request type: ${authenticationRequestType}`);
  }

  // Extract the salt
  return {
    type: MessageType.AuthenticationRequest,
    authenticationRequestType: AuthenticationRequestType.MD5Password,
    salt: new Uint8Array(message.buffer, message.byteOffset + 9, 4),
  };
}

/**
 * Checks if a message is an AuthenticationMD5Password message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONMD5PASSWORD
 */
export function isAuthenticationMD5Password(message: Uint8Array): boolean {
  if (message.length < 9) {
    return false;
  }
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  return (
    view.getUint8(0) === MessageType.AuthenticationRequest &&
    view.getInt32(5) === AuthenticationRequestType.MD5Password
  );
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('AuthenticationMD5Password', () => {
    const salt = new Uint8Array([1, 2, 3, 4]);
    const message = createAuthenticationMD5Password(salt);
    expect(isAuthenticationMD5Password(message)).toBe(true);
    const parsed = parseAuthenticationMD5Password(message);
    expect(parsed).toEqual({
      type: MessageType.AuthenticationRequest,
      authenticationRequestType: AuthenticationRequestType.MD5Password,
      salt,
    });
  });
}
