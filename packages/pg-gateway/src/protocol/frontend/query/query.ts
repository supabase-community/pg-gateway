import { MessageType } from '../message-type';

/**
 * Creates a Query message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-QUERY
 */
export function createQuery(query: string): Uint8Array {
  const encoder = new TextEncoder();
  const queryBytes = encoder.encode(`${query}\0`);

  // Calculate message length: int32 length + query string + null terminator
  const messageLength = 4 + queryBytes.length;

  const buffer = new ArrayBuffer(1 + messageLength);
  const view = new DataView(buffer);
  let offset = 0;

  // Byte1('Q') - Identifies the message as a Query
  view.setUint8(offset, MessageType.Query);
  offset += 1;

  // Int32 - Length of message contents in bytes
  view.setInt32(offset, messageLength);
  offset += 4;

  // String - The query string
  new Uint8Array(buffer, offset, queryBytes.length).set(queryBytes);

  return new Uint8Array(buffer);
}

/**
 * Parses a Query message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-QUERY
 */
export function parseQuery(message: Uint8Array): {
  type: typeof MessageType.Query;
  query: string;
} {
  if (message.length < 6) {
    throw new Error(`Invalid length: ${message.length}`);
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;

  // Check message type
  const messageType = view.getUint8(offset);
  if (messageType !== MessageType.Query) {
    throw new Error(`Invalid message type: ${messageType}`);
  }
  offset += 1;

  // Check message length
  const length = view.getInt32(offset);
  if (length !== message.length - 1) {
    throw new Error(`Invalid message length: ${length}`);
  }
  offset += 4;

  // Parse query string (excluding null terminator)
  const end = message.indexOf(0, offset);
  const query = decoder.decode(message.subarray(offset, end));

  return {
    type: MessageType.Query,
    query,
  };
}

/**
 * Checks if a message is a Query message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-QUERY
 */
export function isQuery(message: Uint8Array): boolean {
  return message[0] === MessageType.Query;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('Query', () => {
    const queryString = 'SELECT * FROM "table-name" WHERE column @> \'{"key": "value"}\'::jsonb';
    const message = createQuery(queryString);
    expect(isQuery(message)).toBe(true);
    const parsed = parseQuery(message);
    expect(parsed).toEqual({
      type: MessageType.Query,
      query: queryString,
    });
  });
}
