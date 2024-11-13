import { MessageType } from '../message-type';

/**
 * Creates a Function Call message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-FUNCTIONCALL
 */
export function createFunctionCall({
  functionId,
  parameters = [],
  parameterFormats = [],
  resultFormat = 0,
}: {
  functionId: number;
  parameters?: Array<Uint8Array | null>;
  parameterFormats?: (0 | 1)[];
  resultFormat?: 0 | 1;
}): Uint8Array {
  // Calculate the total message length
  let messageLength = 4; // Initial length field
  messageLength += 4; // Function ID
  messageLength += 2; // Format codes count
  messageLength += parameterFormats.length * 2; // Format codes
  messageLength += 2; // Parameter count

  // Parameter lengths and values
  for (const param of parameters) {
    messageLength += 4; // Parameter length field
    if (param !== null) {
      messageLength += param.length;
    }
  }

  messageLength += 2; // Result format code

  const buffer = new ArrayBuffer(1 + messageLength);
  const view = new DataView(buffer);
  let offset = 0;

  // Byte1('F') - Identifies the message as a Function Call
  view.setUint8(offset, MessageType.FunctionCall);
  offset += 1;

  // Int32 - Length of message contents in bytes
  view.setInt32(offset, messageLength);
  offset += 4;

  // Int32 - Specifies the object ID of the function to call
  view.setInt32(offset, functionId);
  offset += 4;

  // Int16 - Number of parameter format codes
  view.setInt16(offset, parameterFormats.length);
  offset += 2;

  // Int16[] - Parameter format codes
  // If parameterFormats.length is 1, that format applies to all parameters
  // If parameterFormats.length is 0, all parameters use text format
  // If parameterFormats.length equals parameters.length, formats are applied 1:1
  if (parameterFormats.length === 1) {
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    view.setInt16(offset, parameterFormats[0]!);
    offset += 2;
  } else {
    for (const code of parameterFormats) {
      view.setInt16(offset, code);
      offset += 2;
    }
  }

  // Int16 - Number of parameters
  view.setInt16(offset, parameters.length);
  offset += 2;

  // For each parameter
  for (const param of parameters) {
    if (param === null) {
      view.setInt32(offset, -1);
      offset += 4;
    } else {
      view.setInt32(offset, param.length);
      offset += 4;
      new Uint8Array(buffer, offset, param.length).set(param);
      offset += param.length;
    }
  }

  // Int16 - The format code for the result (0 = text, 1 = binary)
  view.setInt16(offset, resultFormat);

  return new Uint8Array(buffer);
}

/**
 * Parses a Function Call message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-FUNCTIONCALL
 */
export function parseFunctionCall(message: Uint8Array): {
  type: typeof MessageType.FunctionCall;
  functionId: number;
  parameterFormats: (0 | 1)[];
  parameters: Array<Uint8Array | null>;
  resultFormat: 0 | 1;
} {
  if (message.length < 9) {
    throw new Error(`Invalid length: ${message.length}`);
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  let offset = 0;

  // Check message type
  const messageType = view.getUint8(offset);
  if (messageType !== MessageType.FunctionCall) {
    throw new Error(`Invalid message type: ${messageType}`);
  }
  offset += 1;

  // Check message length
  const length = view.getInt32(offset);
  if (length !== message.length - 1) {
    throw new Error(`Invalid message length: ${length}`);
  }
  offset += 4;

  // Get function ID
  const functionId = view.getInt32(offset);
  offset += 4;

  // Get format codes
  const formatCodeCount = view.getInt16(offset);
  offset += 2;
  const parameterFormats: (0 | 1)[] = [];
  for (let i = 0; i < formatCodeCount; i++) {
    parameterFormats.push(view.getInt16(offset) as 0 | 1);
    offset += 2;
  }

  // Get number of parameters
  const paramCount = view.getInt16(offset);
  offset += 2;

  // Parse parameters
  const parameters: Array<Uint8Array | null> = [];
  for (let i = 0; i < paramCount; i++) {
    const paramLength = view.getInt32(offset);
    offset += 4;
    if (paramLength === -1) {
      parameters.push(null);
    } else {
      parameters.push(new Uint8Array(message.buffer, message.byteOffset + offset, paramLength));
      offset += paramLength;
    }
  }

  // Get result format
  const resultFormat = view.getInt16(offset) as 0 | 1;

  return {
    type: MessageType.FunctionCall,
    functionId,
    parameterFormats,
    parameters,
    resultFormat,
  };
}

/**
 * Checks if a message is a Function Call message.
 * @see https://www.postgresql.org/docs/17/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-FUNCTIONCALL
 */
export function isFunctionCall(message: Uint8Array): boolean {
  return message[0] === MessageType.FunctionCall;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;

  test('FunctionCall with binary format', () => {
    const encoder = new TextEncoder();
    const message = createFunctionCall({
      functionId: 12345,
      parameters: [encoder.encode('param1'), null, encoder.encode('param3')],
      parameterFormats: [1], // Use binary format for all parameters
      resultFormat: 1,
    });

    expect(isFunctionCall(message)).toBe(true);
    const parsed = parseFunctionCall(message);
    expect(parsed).toEqual({
      type: MessageType.FunctionCall,
      functionId: 12345,
      parameterFormats: [1],
      parameters: [encoder.encode('param1'), null, encoder.encode('param3')],
      resultFormat: 1,
    });
  });

  test('FunctionCall with text format', () => {
    const encoder = new TextEncoder();
    const message = createFunctionCall({
      functionId: 12345,
      parameters: [encoder.encode('param1')],
      parameterFormats: [], // Use text format for all parameters
      resultFormat: 0,
    });

    const parsed = parseFunctionCall(message);
    expect(parsed).toEqual({
      type: MessageType.FunctionCall,
      functionId: 12345,
      parameterFormats: [],
      parameters: [encoder.encode('param1')],
      resultFormat: 0,
    });
  });

  test('FunctionCall with mixed formats', () => {
    const encoder = new TextEncoder();
    const message = createFunctionCall({
      functionId: 12345,
      parameters: [encoder.encode('param1'), encoder.encode('param2')],
      parameterFormats: [0, 1], // Text format for first param, binary for second
      resultFormat: 0,
    });

    const parsed = parseFunctionCall(message);
    expect(parsed).toEqual({
      type: MessageType.FunctionCall,
      functionId: 12345,
      parameterFormats: [0, 1],
      parameters: [encoder.encode('param1'), encoder.encode('param2')],
      resultFormat: 0,
    });
  });
}
