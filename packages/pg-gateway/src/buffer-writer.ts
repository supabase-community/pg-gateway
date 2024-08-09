/**
 * binary data  BufferWriter tuned for encoding binary specific to the postgres binary protocol
 *
 * @see https://github.com/brianc/node-postgres/blob/54eb0fa216aaccd727765641e7d1cf5da2bc483d/packages/pg-protocol/src/buffer- BufferWriter.ts
 */
export class BufferWriter {
  private buffer: Buffer;
  private offset = 5;
  private headerPosition = 0;
  constructor(private size = 256) {
    this.buffer = Buffer.allocUnsafe(size);
  }

  private ensure(size: number): void {
    const remaining = this.buffer.length - this.offset;
    if (remaining < size) {
      const oldBuffer = this.buffer;
      // exponential growth factor of around ~ 1.5
      // https://stackoverflow.com/questions/2269063/buffer-growth-strategy
      const newSize = oldBuffer.length + (oldBuffer.length >> 1) + size;
      this.buffer = Buffer.allocUnsafe(newSize);
      oldBuffer.copy(this.buffer);
    }
  }

  public addInt32(num: number): BufferWriter {
    this.ensure(4);
    this.buffer[this.offset++] = (num >>> 24) & 0xff;
    this.buffer[this.offset++] = (num >>> 16) & 0xff;
    this.buffer[this.offset++] = (num >>> 8) & 0xff;
    this.buffer[this.offset++] = (num >>> 0) & 0xff;
    return this;
  }

  public addInt16(num: number): BufferWriter {
    this.ensure(2);
    this.buffer[this.offset++] = (num >>> 8) & 0xff;
    this.buffer[this.offset++] = (num >>> 0) & 0xff;
    return this;
  }

  public addCString(string: string): BufferWriter {
    if (!string) {
      this.ensure(1);
    } else {
      const len = Buffer.byteLength(string);
      this.ensure(len + 1); // +1 for null terminator
      this.buffer.write(string, this.offset, 'utf-8');
      this.offset += len;
    }

    this.buffer[this.offset++] = 0; // null terminator
    return this;
  }

  public addString(string = ''): BufferWriter {
    const len = Buffer.byteLength(string);
    this.ensure(len);
    this.buffer.write(string, this.offset);
    this.offset += len;
    return this;
  }

  public add(otherBuffer: Buffer): BufferWriter {
    this.ensure(otherBuffer.length);
    otherBuffer.copy(this.buffer, this.offset);
    this.offset += otherBuffer.length;
    return this;
  }

  private join(code?: number): Buffer {
    if (code) {
      this.buffer[this.headerPosition] = code;
      //length is everything in this packet minus the code
      const length = this.offset - (this.headerPosition + 1);
      this.buffer.writeInt32BE(length, this.headerPosition + 1);
    }
    return this.buffer.slice(code ? 0 : 5, this.offset);
  }

  public flush(code?: number): Buffer {
    const result = this.join(code);
    this.offset = 5;
    this.headerPosition = 0;
    this.buffer = Buffer.allocUnsafe(this.size);
    return result;
  }
}