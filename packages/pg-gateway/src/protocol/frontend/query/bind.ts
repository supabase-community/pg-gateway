import { MessageType } from '../message-type';

/**
 * Creates a Bind message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BIND
 */
export function createBind({
  portal = '',
  preparedStatement = '',
  formatCodes = [],
  parameters = [],
  resultFormatCodes = [],
}: {
  portal?: string;
  preparedStatement?: string;
  formatCodes?: (0 | 1)[];
  parameters?: Uint8Array[];
  resultFormatCodes?: (0 | 1)[];
}): Uint8Array {
  const encoder = new TextEncoder();
  const portalBytes = encoder.encode(`${portal}\0`);
  const preparedStatementBytes = encoder.encode(`${preparedStatement}\0`);

  // Calculate the total message length
  let messageLength = 4; // Initial length field
  messageLength += portalBytes.length;
  messageLength += preparedStatementBytes.length;
  messageLength += 2; // Format codes count
  messageLength += formatCodes.length * 2;
  messageLength += 2; // Parameter count
  for (const param of parameters) {
    messageLength += 4; // Parameter length
    messageLength += param.length;
  }
  messageLength += 2; // Result format codes count
  messageLength += resultFormatCodes.length * 2;

  const buffer = new ArrayBuffer(1 + messageLength);
  const view = new DataView(buffer);
  let offset = 0;

  // Byte1('B') - Identifies the message as a Bind command
  view.setUint8(offset, MessageType.Bind);
  offset += 1;

  // Int32 - Length of message contents in bytes
  view.setInt32(offset, messageLength);
  offset += 4;

  // String - Name of the destination portal
  new Uint8Array(buffer, offset, portalBytes.length).set(portalBytes);
  offset += portalBytes.length;

  // String - Name of the source prepared statement
  new Uint8Array(buffer, offset, preparedStatementBytes.length).set(preparedStatementBytes);
  offset += preparedStatementBytes.length;

  // Int16 - Number of parameter format codes
  view.setInt16(offset, formatCodes.length);
  offset += 2;

  // Int16[] - Parameter format codes
  // If formatCodes.length is 1, that format applies to all parameters
  // If formatCodes.length is 0, all parameters use text format
  // If formatCodes.length equals parameters.length, formats are applied 1:1
  if (formatCodes.length === 1) {
    // Single format code applies to all parameters
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    view.setInt16(offset, formatCodes[0]!);
    offset += 2;
  } else {
    // Either 0 codes (all text) or one code per parameter
    for (const code of formatCodes) {
      view.setInt16(offset, code);
      offset += 2;
    }
  }

  // Int16 - Number of parameter values
  view.setInt16(offset, parameters.length);
  offset += 2;

  // For each parameter
  for (const param of parameters) {
    // Int32 - Length of parameter value
    view.setInt32(offset, param.length);
    offset += 4;
    // Byte_n - Parameter value
    new Uint8Array(buffer, offset, param.length).set(param);
    offset += param.length;
  }

  // Int16 - Number of result-column format codes
  view.setInt16(offset, resultFormatCodes.length);
  offset += 2;

  // Int16[] - Result-column format codes
  // If resultFormatCodes.length is 1, that format applies to all result columns
  // If resultFormatCodes.length is 0, all result columns use text format
  // If resultFormatCodes.length equals actual number of result columns, formats are applied 1:1
  if (resultFormatCodes.length === 1) {
    // Single format code applies to all result columns
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    view.setInt16(offset, resultFormatCodes[0]!);
    offset += 2;
  } else {
    // Either 0 codes (all text) or one code per result column
    for (const code of resultFormatCodes) {
      view.setInt16(offset, code);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

/**
 * Parses a Bind message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BIND
 */
export function parseBind(message: Uint8Array): {
  type: typeof MessageType.Bind;
  portal: string;
  preparedStatement: string;
  formatCodes: (0 | 1)[];
  parameters: Uint8Array[];
  resultFormatCodes: number[];
} {
  if (message.length < 7) {
    throw new Error(`Invalid length: ${message.length}`);
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;

  // Check message type
  const messageType = view.getUint8(offset);
  if (messageType !== MessageType.Bind) {
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
  let end = message.indexOf(0, offset);
  const portal = decoder.decode(message.subarray(offset, end));
  offset = end + 1;

  // Parse prepared statement name
  end = message.indexOf(0, offset);
  const preparedStatement = decoder.decode(message.subarray(offset, end));
  offset = end + 1;

  // Parse format codes
  const formatCodeCount = view.getInt16(offset);
  offset += 2;
  const formatCodes: (0 | 1)[] = [];
  for (let i = 0; i < formatCodeCount; i++) {
    formatCodes.push(view.getInt16(offset) as 0 | 1);
    offset += 2;
  }

  // Parse parameters
  const parameterCount = view.getInt16(offset);
  offset += 2;
  const parameters: Uint8Array[] = [];
  for (let i = 0; i < parameterCount; i++) {
    const paramLength = view.getInt32(offset);
    offset += 4;
    if (paramLength === -1) {
      parameters.push(new Uint8Array(0));
    } else {
      parameters.push(new Uint8Array(message.buffer, message.byteOffset + offset, paramLength));
      offset += paramLength;
    }
  }

  // Parse result format codes
  const resultFormatCodeCount = view.getInt16(offset);
  offset += 2;
  const resultFormatCodes: number[] = [];
  for (let i = 0; i < resultFormatCodeCount; i++) {
    resultFormatCodes.push(view.getInt16(offset));
    offset += 2;
  }

  return {
    type: MessageType.Bind,
    portal,
    preparedStatement,
    formatCodes,
    parameters,
    resultFormatCodes,
  };
}

/**
 * Checks if a message is a Bind message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BIND
 */
export function isBind(message: Uint8Array): boolean {
  return message[0] === MessageType.Bind;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;

  test('Bind', () => {
    const parameters = [new Uint8Array([1, 2, 3])];
    const formatCodes: (0 | 1)[] = [1];
    const resultFormatCodes: (0 | 1)[] = [0];
    const message = createBind({
      portal: 'myportal',
      preparedStatement: 'mystatement',
      formatCodes,
      parameters,
      resultFormatCodes,
    });
    expect(isBind(message)).toBe(true);
    const parsed = parseBind(message);
    expect(parsed).toEqual({
      type: MessageType.Bind,
      portal: 'myportal',
      preparedStatement: 'mystatement',
      formatCodes,
      parameters,
      resultFormatCodes,
    });
  });
}
