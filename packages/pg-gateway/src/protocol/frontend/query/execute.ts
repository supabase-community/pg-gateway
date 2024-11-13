import { MessageType } from '../message-type';

/**
 * Creates an Execute message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-EXECUTE
 */
export function createExecute({
  portal = '',
  maxRows = 0,
}: {
  portal?: string;
  maxRows?: number;
}): Uint8Array {
  const encoder = new TextEncoder();
  const portalBytes = encoder.encode(`${portal}\0`);

  // Calculate message length: portal name + null terminator + maxRows
  const messageLength = 4 + portalBytes.length + 4;

  const buffer = new ArrayBuffer(1 + messageLength);
  const view = new DataView(buffer);
  let offset = 0;

  // Byte1('E') - Identifies the message as an Execute
  view.setUint8(offset, MessageType.Execute);
  offset += 1;

  // Int32 - Length of message contents in bytes
  view.setInt32(offset, messageLength);
  offset += 4;

  // String - The name of the portal to execute
  new Uint8Array(buffer, offset, portalBytes.length).set(portalBytes);
  offset += portalBytes.length;

  // Int32 - Maximum number of rows to return (0 = no limit)
  view.setInt32(offset, maxRows);

  return new Uint8Array(buffer);
}

/**
 * Parses an Execute message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-EXECUTE
 */
export function parseExecute(message: Uint8Array): {
  type: typeof MessageType.Execute;
  portal: string;
  maxRows: number;
} {
  if (message.length < 10) {
    throw new Error(`Invalid length: ${message.length}`);
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;

  // Check message type
  const messageType = view.getUint8(offset);
  if (messageType !== MessageType.Execute) {
    throw new Error(`Invalid message type: ${messageType}`);
  }
  offset += 1;

  // Check message length
  const length = view.getInt32(offset);
  if (length !== message.length - 1) {
    throw new Error(`Invalid message length: ${length}`);
  }
  offset += 4;

  // Parse portal name
  const end = message.indexOf(0, offset);
  const portal = decoder.decode(message.subarray(offset, end));
  offset = end + 1;

  // Parse maximum number of rows
  const maxRows = view.getInt32(offset);

  return {
    type: MessageType.Execute,
    portal,
    maxRows,
  };
}

/**
 * Checks if a message is an Execute message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-EXECUTE
 */
export function isExecute(message: Uint8Array): boolean {
  return message[0] === MessageType.Execute;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('Execute', () => {
    const message = createExecute({
      portal: 'my_portal',
      maxRows: 100,
    });
    expect(isExecute(message)).toBe(true);
    const parsed = parseExecute(message);
    expect(parsed).toEqual({
      type: MessageType.Execute,
      portal: 'my_portal',
      maxRows: 100,
    });
  });
}
