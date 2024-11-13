import { MessageType } from '../message-type';
import { Variant, type VariantValue } from './variant-type';

/**
 * Creates a Describe message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-DESCRIBE
 */
export function createDescribe({
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

  // Byte1('D') - Identifies the message as a Describe
  view.setUint8(offset, MessageType.Describe);
  offset += 1;

  // Int32 - Length of message contents in bytes
  view.setInt32(offset, messageLength);
  offset += 4;

  // Byte1 - 'S' to describe a prepared statement; or 'P' to describe a portal
  view.setUint8(offset, variant.charCodeAt(0));
  offset += 1;

  // String - The name of the prepared statement or portal to describe
  new Uint8Array(buffer, offset, nameBytes.length).set(nameBytes);

  return new Uint8Array(buffer);
}

/**
 * Parses a Describe message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-DESCRIBE
 */
export function parseDescribe(message: Uint8Array): {
  type: typeof MessageType.Describe;
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
  if (messageType !== MessageType.Describe) {
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
    throw new Error(`Invalid describe variant: ${variant}`);
  }
  offset += 1;

  // Get name (excluding null terminator)
  const end = message.indexOf(0, offset);
  const name = decoder.decode(message.subarray(offset, end));

  return {
    type: MessageType.Describe,
    variant,
    name,
  };
}

/**
 * Checks if a message is a Describe message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-DESCRIBE
 */
export function isDescribe(message: Uint8Array): boolean {
  return message[0] === MessageType.Describe;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test('Describe', () => {
    const message = createDescribe({
      variant: Variant.PreparedStatement,
      name: 'my_prepared_statement',
    });
    expect(isDescribe(message)).toBe(true);
    const parsed = parseDescribe(message);
    expect(parsed).toEqual({
      type: MessageType.Describe,
      variant: Variant.PreparedStatement,
      name: 'my_prepared_statement',
    });
  });
}
