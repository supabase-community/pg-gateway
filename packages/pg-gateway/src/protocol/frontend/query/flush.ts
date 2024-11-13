import { MessageType } from '../message-type';

/**
 * Creates a Flush message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-FLUSH
 */
export function createFlush(): Uint8Array {
  // Calculate message length: just the length field
  const messageLength = 4;

  const buffer = new ArrayBuffer(1 + messageLength);
  const view = new DataView(buffer);
  let offset = 0;

  // Byte1('H') - Identifies the message as a Flush
  view.setUint8(offset, MessageType.Flush);
  offset += 1;

  // Int32 - Length of message contents in bytes
  view.setInt32(offset, messageLength);

  return new Uint8Array(buffer);
}

/**
 * Parses a Flush message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-FLUSH
 */
export function parseFlush(message: Uint8Array): {
  type: typeof MessageType.Flush;
} {
  if (message.length < 5) {
    throw new Error(`Invalid length: ${message.length}`);
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  let offset = 0;

  // Check message type
  const messageType = view.getUint8(offset);
  if (messageType !== MessageType.Flush) {
    throw new Error(`Invalid message type: ${messageType}`);
  }
  offset += 1;

  // Check message length
  const length = view.getInt32(offset);
  if (length !== message.length - 1) {
    throw new Error(`Invalid message length: ${length}`);
  }

  return {
    type: MessageType.Flush,
  };
}

/**
 * Checks if a message is a Flush message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-FLUSH
 */
export function isFlush(message: Uint8Array): boolean {
  return message[0] === MessageType.Flush;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('Flush', () => {
    const message = createFlush();
    expect(isFlush(message)).toBe(true);
    const parsed = parseFlush(message);
    expect(parsed).toEqual({
      type: MessageType.Flush,
    });
  });
}
