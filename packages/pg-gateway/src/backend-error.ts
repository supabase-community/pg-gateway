import { BufferWriter } from './buffer-writer.js';
import { BackendMessageCode } from './message-codes.js';

interface BackendErrorParams {
  severity: 'ERROR' | 'FATAL' | 'PANIC';
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
}

/**
 * Represents a backend error message
 *
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-ERRORRESPONSE
 *
 * For error fields, @see https://www.postgresql.org/docs/current/protocol-error-fields.html#PROTOCOL-ERROR-FIELDS
 */
export class BackendError {
  severity!: 'ERROR' | 'FATAL' | 'PANIC';
  code!: string;
  message!: string;
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

  constructor(params: BackendErrorParams) {
    Object.assign(this, params);
  }

  /**
   * Creates a backend error message
   *
   * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-ERRORRESPONSE
   *
   * For error fields, @see https://www.postgresql.org/docs/current/protocol-error-fields.html#PROTOCOL-ERROR-FIELDS
   */
  static create(params: BackendErrorParams) {
    return new BackendError(params);
  }

  flush() {
    const writer = new BufferWriter();

    writer.addString('S');
    writer.addCString(this.severity);

    writer.addString('V');
    writer.addCString(this.severity);

    writer.addString('C');
    writer.addCString(this.code);

    writer.addString('M');
    writer.addCString(this.message);

    if (this.detail !== undefined) {
      writer.addString('D');
      writer.addCString(this.detail);
    }

    if (this.hint !== undefined) {
      writer.addString('H');
      writer.addCString(this.hint);
    }

    if (this.position !== undefined) {
      writer.addString('P');
      writer.addCString(this.position);
    }

    if (this.internalPosition !== undefined) {
      writer.addString('p');
      writer.addCString(this.internalPosition);
    }

    if (this.internalQuery !== undefined) {
      writer.addString('q');
      writer.addCString(this.internalQuery);
    }

    if (this.where !== undefined) {
      writer.addString('W');
      writer.addCString(this.where);
    }

    if (this.schema !== undefined) {
      writer.addString('s');
      writer.addCString(this.schema);
    }

    if (this.table !== undefined) {
      writer.addString('t');
      writer.addCString(this.table);
    }

    if (this.column !== undefined) {
      writer.addString('c');
      writer.addCString(this.column);
    }

    if (this.dataType !== undefined) {
      writer.addString('d');
      writer.addCString(this.dataType);
    }

    if (this.constraint !== undefined) {
      writer.addString('n');
      writer.addCString(this.constraint);
    }

    if (this.file !== undefined) {
      writer.addString('F');
      writer.addCString(this.file);
    }

    if (this.line !== undefined) {
      writer.addString('L');
      writer.addCString(this.line);
    }

    if (this.routine !== undefined) {
      writer.addString('R');
      writer.addCString(this.routine);
    }

    // Add null byte to the end
    writer.addCString('');

    return writer.flush(BackendMessageCode.ErrorMessage);
  }
}
