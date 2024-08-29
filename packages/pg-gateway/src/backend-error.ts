import { BufferReader } from './buffer-reader.js';
import { BufferWriter } from './buffer-writer.js';
import { BackendMessageCode } from './message-codes.js';

export type ErrorNoticeBase = {
  severity: string;
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;
};

export type BackendError = ErrorNoticeBase & {
  severity: 'ERROR' | 'FATAL' | 'PANIC';
};

export type BackendNotice = ErrorNoticeBase & {
  severity: 'WARNING' | 'NOTICE' | 'DEBUG' | 'INFO' | 'LOG';
};

/**
 * Creates a backend error message
 *
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-ERRORRESPONSE
 */
export function createBackendErrorMessage(error: BackendError) {
  const writer = new BufferWriter();

  writer.addString('S');
  writer.addCString(error.severity);

  writer.addString('V');
  writer.addCString(error.severity);

  writer.addString('C');
  writer.addCString(error.code);

  writer.addString('M');
  writer.addCString(error.message);

  if (error.detail !== undefined) {
    writer.addString('D');
    writer.addCString(error.detail);
  }

  if (error.hint !== undefined) {
    writer.addString('H');
    writer.addCString(error.hint);
  }

  if (error.position !== undefined) {
    writer.addString('P');
    writer.addCString(error.position);
  }

  if (error.internalPosition !== undefined) {
    writer.addString('p');
    writer.addCString(error.internalPosition);
  }

  if (error.internalQuery !== undefined) {
    writer.addString('q');
    writer.addCString(error.internalQuery);
  }

  if (error.where !== undefined) {
    writer.addString('W');
    writer.addCString(error.where);
  }

  if (error.schema !== undefined) {
    writer.addString('s');
    writer.addCString(error.schema);
  }

  if (error.table !== undefined) {
    writer.addString('t');
    writer.addCString(error.table);
  }

  if (error.column !== undefined) {
    writer.addString('c');
    writer.addCString(error.column);
  }

  if (error.dataType !== undefined) {
    writer.addString('d');
    writer.addCString(error.dataType);
  }

  if (error.constraint !== undefined) {
    writer.addString('n');
    writer.addCString(error.constraint);
  }

  if (error.file !== undefined) {
    writer.addString('F');
    writer.addCString(error.file);
  }

  if (error.line !== undefined) {
    writer.addString('L');
    writer.addCString(error.line);
  }

  if (error.routine !== undefined) {
    writer.addString('R');
    writer.addCString(error.routine);
  }

  // Add null byte to the end
  writer.addCString('');

  return writer.flush(BackendMessageCode.ErrorMessage);
}

export function readNoticeResponse(message: Buffer) {
  const reader = new BufferReader();
  reader.setBuffer(0, message);

  const code = reader.byte();
  const length = reader.int32();

  const notice: Partial<BackendNotice> = {};

  // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
  for (let fieldCode: string; (fieldCode = reader.string(1)) !== '\0'; ) {
    const fieldName = getFieldName(fieldCode);
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    notice[fieldName] = reader.cstring() as any;
  }

  return notice as BackendNotice;
}

function getFieldName(code: string): keyof ErrorNoticeBase {
  switch (code) {
    case 'S':
      return 'severity';
    case 'V':
      return 'severity';
    case 'C':
      return 'code';
    case 'M':
      return 'message';
    case 'D':
      return 'detail';
    case 'H':
      return 'hint';
    case 'P':
      return 'position';
    case 'p':
      return 'internalPosition';
    case 'q':
      return 'internalQuery';
    case 'W':
      return 'where';
    case 's':
      return 'schema';
    case 't':
      return 'table';
    case 'c':
      return 'column';
    case 'd':
      return 'dataType';
    case 'n':
      return 'constraint';
    case 'F':
      return 'file';
    case 'L':
      return 'line';
    case 'R':
      return 'routine';
    default:
      throw new Error(`Unknown error/notice code '${code}'`);
  }
}
