import { MessageType } from '../message-type';
import { ParameterType } from '../parameter-type';

/**
 * Creates a Parse message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE
 */
export function createParse({
  preparedStatement = '',
  query = '',
  parameterTypes = [],
}: {
  preparedStatement?: string;
  query?: string;
  parameterTypes?: number[];
}): Uint8Array {
  const encoder = new TextEncoder();
  const preparedStatementBytes = encoder.encode(`${preparedStatement}\0`);
  const queryBytes = encoder.encode(`${query}\0`);

  // Calculate message length
  const messageLength =
    4 + // Length field
    preparedStatementBytes.length +
    queryBytes.length +
    2 + // Parameter count
    parameterTypes.length * 4; // OIDs are 4 bytes each

  const buffer = new ArrayBuffer(1 + messageLength);
  const view = new DataView(buffer);
  let offset = 0;

  // Byte1('P') - Identifies the message as a Parse command
  view.setUint8(offset, MessageType.Parse);
  offset += 1;

  // Int32 - Length of message contents in bytes
  view.setInt32(offset, messageLength);
  offset += 4;

  // String - Name of the destination prepared statement
  new Uint8Array(buffer, offset, preparedStatementBytes.length).set(preparedStatementBytes);
  offset += preparedStatementBytes.length;

  // String - The query string
  new Uint8Array(buffer, offset, queryBytes.length).set(queryBytes);
  offset += queryBytes.length;

  // Int16 - Number of parameter data types
  view.setInt16(offset, parameterTypes.length);
  offset += 2;

  // Int32[] - Parameter data types
  for (const oid of parameterTypes) {
    view.setInt32(offset, oid);
    offset += 4;
  }

  return new Uint8Array(buffer);
}

/**
 * Parses a Parse message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE
 */
export function parseParse(message: Uint8Array): {
  type: typeof MessageType.Parse;
  preparedStatement: string;
  query: string;
  parameterTypes: number[];
} {
  if (message.length < 7) {
    throw new Error(`Invalid length: ${message.length}`);
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;

  // Check message type
  const messageType = view.getUint8(offset);
  if (messageType !== MessageType.Parse) {
    throw new Error(`Invalid message type: ${messageType}`);
  }
  offset += 1;

  // Check message length
  const length = view.getInt32(offset);
  if (length !== message.length - 1) {
    throw new Error(`Invalid message length: ${length}`);
  }
  offset += 4;

  // Parse prepared statement name
  let end = message.indexOf(0, offset);
  const preparedStatement = decoder.decode(message.subarray(offset, end));
  offset = end + 1;

  // Parse query string
  end = message.indexOf(0, offset);
  const query = decoder.decode(message.subarray(offset, end));
  offset = end + 1;

  // Parse parameter types
  const parameterCount = view.getInt16(offset);
  offset += 2;
  const parameterTypes: number[] = [];
  for (let i = 0; i < parameterCount; i++) {
    parameterTypes.push(view.getInt32(offset));
    offset += 4;
  }

  return {
    type: MessageType.Parse,
    preparedStatement,
    query,
    parameterTypes,
  };
}

/**
 * Checks if a message is a Parse message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE
 */
export function isParse(message: Uint8Array): boolean {
  return message[0] === MessageType.Parse;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('Parse', () => {
    const message = createParse({
      preparedStatement: 'stmt1',
      query: 'SELECT * FROM users WHERE id = $1',
      parameterTypes: [ParameterType.Integer],
    });
    expect(isParse(message)).toBe(true);
    const parsed = parseParse(message);
    expect(parsed).toEqual({
      type: MessageType.Parse,
      preparedStatement: 'stmt1',
      query: 'SELECT * FROM users WHERE id = $1',
      parameterTypes: [ParameterType.Integer],
    });
  });
}
