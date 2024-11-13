import { AuthenticationRequestType } from './authentication-request-type';
import { MessageType } from '../message-type';

/**
 * Creates an AuthenticationGSSContinue message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONGSSCONTINUE
 */
export function createAuthenticationGSSContinue(gssData: Uint8Array): Uint8Array {
  const messageLength = 8 + gssData.length; // 4 bytes for length + 4 bytes for auth type + gssData
  const buffer = new ArrayBuffer(1 + messageLength); // 1 byte for type + message length
  const view = new DataView(buffer);

  // Byte1('R') - Identifies the message as an authentication request
  view.setUint8(0, MessageType.AuthenticationRequest);

  // Int32 - Length of message contents in bytes, including self
  view.setUint32(1, messageLength);

  // Int32(8) - Specifies that this message contains GSSAPI or SSPI data
  view.setUint32(5, AuthenticationRequestType.GSSContinue);

  // Byte_n - GSSAPI or SSPI authentication data
  new Uint8Array(buffer, 9).set(gssData);

  return new Uint8Array(buffer);
}

/**
 * Parses an AuthenticationGSSContinue message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONGSSCONTINUE
 */
export function parseAuthenticationGSSContinue(message: Uint8Array): {
  type: typeof MessageType.AuthenticationRequest;
  authenticationRequestType: typeof AuthenticationRequestType.GSSContinue;
  gssData: Uint8Array;
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
  if (authenticationRequestType !== AuthenticationRequestType.GSSContinue) {
    throw new Error(`Invalid authentication request type: ${authenticationRequestType}`);
  }

  return {
    type: MessageType.AuthenticationRequest,
    authenticationRequestType: AuthenticationRequestType.GSSContinue,
    gssData: new Uint8Array(message.buffer, message.byteOffset + 9),
  };
}

/**
 * Checks if a message is an AuthenticationGSSContinue message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATIONGSSCONTINUE
 */
export function isAuthenticationGSSContinue(message: Uint8Array): boolean {
  if (message.length < 9) {
    return false;
  }
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  return (
    view.getUint8(0) === MessageType.AuthenticationRequest &&
    view.getInt32(5) === AuthenticationRequestType.GSSContinue
  );
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('AuthenticationGSSContinue', () => {
    const gssData = new Uint8Array([1, 2, 3, 4]);
    const message = createAuthenticationGSSContinue(gssData);
    expect(isAuthenticationGSSContinue(message)).toBe(true);
    const parsed = parseAuthenticationGSSContinue(message);
    expect(parsed).toEqual({
      type: MessageType.AuthenticationRequest,
      authenticationRequestType: AuthenticationRequestType.GSSContinue,
      gssData,
    });
  });
}
