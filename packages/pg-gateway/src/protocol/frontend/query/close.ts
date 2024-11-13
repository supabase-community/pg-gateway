import { MessageType } from '../message-type';
import { Variant, type VariantValue } from './variant-type';

/**
 * Creates a Close message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-CLOSE
 */
export function createClose({
  variant,
  name = '',
}: {
  variant: VariantValue;
  name?: string;
}): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(`${name}\0`);

  // Calculate message length: variant (1) + name + null terminator
  const messageLength = 4 + 1 + nameBytes.length;

  const buffer = new ArrayBuffer(1 + messageLength);
  const view = new DataView(buffer);
  let offset = 0;

  // Byte1('C') - Identifies the message as a Close command
  view.setUint8(offset, MessageType.Close);
  offset += 1;

  // Int32 - Length of message contents in bytes
  view.setInt32(offset, messageLength);
  offset += 4;

  // Byte1 - 'S' to close a prepared statement; or 'P' to close a portal
  view.setUint8(offset, variant.charCodeAt(0));
  offset += 1;

  // String - The name of the prepared statement or portal to close
  new Uint8Array(buffer, offset, nameBytes.length).set(nameBytes);

  return new Uint8Array(buffer);
}

/**
 * Parses a Close message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-CLOSE
 */
export function parseClose(message: Uint8Array): {
  type: typeof MessageType.Close;
  variant: VariantValue;
  name: string;
} {
  if (message.length < 7) {
    throw new Error(`Invalid length: ${message.length}`);
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;

  // Check message type
  const messageType = view.getUint8(offset);
  if (messageType !== MessageType.Close) {
    throw new Error(`Invalid message type: ${messageType}`);
  }
  offset += 1;

  // Check message length
  const length = view.getInt32(offset);
  if (length !== message.length - 1) {
    throw new Error(`Invalid message length: ${length}`);
  }
  offset += 4;

  // Get variant (PreparedStatement or Portal)
  const variant = String.fromCharCode(view.getUint8(offset)) as VariantValue;
  if (variant !== Variant.PreparedStatement && variant !== Variant.Portal) {
    throw new Error(`Invalid close variant: ${variant}`);
  }
  offset += 1;

  // Get name (excluding null terminator)
  const end = message.indexOf(0, offset);
  const name = decoder.decode(message.subarray(offset, end));

  return {
    type: MessageType.Close,
    variant,
    name,
  };
}

/**
 * Checks if a message is a Close message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-CLOSE
 */
export function isClose(message: Uint8Array): boolean {
  return message[0] === MessageType.Close;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('Close', () => {
    const message = createClose({
      variant: Variant.PreparedStatement,
      name: 'my_prepared_statement',
    });
    expect(isClose(message)).toBe(true);
    const parsed = parseClose(message);
    expect(parsed).toEqual({
      type: MessageType.Close,
      variant: Variant.PreparedStatement,
      name: 'my_prepared_statement',
    });
  });
}
