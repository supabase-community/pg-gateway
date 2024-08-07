import { type BinaryLike, createHash } from 'node:crypto';
import type { Socket } from 'node:net';
import type { Writer } from 'pg-protocol/dist/buffer-writer';
import { type BackendError, BackendMessageCode } from './connection';

/**
 * Hashes a password using Postgres' nested MD5 algorithm.
 * @see https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-START-UP
 */
export async function hashMd5Password(
  user: string,
  password: string,
  salt: Uint8Array,
) {
  const inner = md5(password + user);
  const outer = md5(Buffer.concat([Buffer.from(inner), salt]));
  return `md5${outer}`;
}

/**
 * Computes the MD5 hash of the given value.
 */
export function md5(value: BinaryLike) {
  return createHash('md5').update(value).digest('hex');
}

/**
 * Generates a random 4-byte salt for MD5 hashing.
 */
export function generateMd5Salt() {
  const salt = new Uint8Array(4);
  crypto.getRandomValues(salt);
  return salt;
}

export interface SocketWriter {
  socket: Socket;
  writer: Writer;
}

export function sendError(this: SocketWriter, error: BackendError) {
  this.writer.addString('S');
  this.writer.addCString(error.severity);

  this.writer.addString('V');
  this.writer.addCString(error.severity);

  this.writer.addString('C');
  this.writer.addCString(error.code);

  this.writer.addString('M');
  this.writer.addCString(error.message);

  if (error.detail !== undefined) {
    this.writer.addString('D');
    this.writer.addCString(error.detail);
  }

  if (error.hint !== undefined) {
    this.writer.addString('H');
    this.writer.addCString(error.hint);
  }

  if (error.position !== undefined) {
    this.writer.addString('P');
    this.writer.addCString(error.position);
  }

  if (error.internalPosition !== undefined) {
    this.writer.addString('p');
    this.writer.addCString(error.internalPosition);
  }

  if (error.internalQuery !== undefined) {
    this.writer.addString('q');
    this.writer.addCString(error.internalQuery);
  }

  if (error.where !== undefined) {
    this.writer.addString('W');
    this.writer.addCString(error.where);
  }

  if (error.schema !== undefined) {
    this.writer.addString('s');
    this.writer.addCString(error.schema);
  }

  if (error.table !== undefined) {
    this.writer.addString('t');
    this.writer.addCString(error.table);
  }

  if (error.column !== undefined) {
    this.writer.addString('c');
    this.writer.addCString(error.column);
  }

  if (error.dataType !== undefined) {
    this.writer.addString('d');
    this.writer.addCString(error.dataType);
  }

  if (error.constraint !== undefined) {
    this.writer.addString('n');
    this.writer.addCString(error.constraint);
  }

  if (error.file !== undefined) {
    this.writer.addString('F');
    this.writer.addCString(error.file);
  }

  if (error.line !== undefined) {
    this.writer.addString('L');
    this.writer.addCString(error.line);
  }

  if (error.routine !== undefined) {
    this.writer.addString('R');
    this.writer.addCString(error.routine);
  }

  // Add null byte to the end
  this.writer.addCString('');

  const response = this.writer.flush(BackendMessageCode.ErrorMessage);

  this.socket.write(response);
}
