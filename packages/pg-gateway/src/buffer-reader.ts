/**
 * Binary data reader tuned for decoding the Postgres wire protocol.
 *
 * @see https://github.com/brianc/node-postgres/blob/54eb0fa216aaccd727765641e7d1cf5da2bc483d/packages/pg-protocol/src/buffer-reader.ts
 */
export class BufferReader {
  private buffer = new ArrayBuffer(0);
  private dataView = new DataView(this.buffer);
  private decoder = new TextDecoder();

  constructor(private offset = 0) {}

  public setBuffer(offset: number, buffer: ArrayBuffer): void {
    this.offset = offset;
    this.buffer = buffer;
    this.dataView = new DataView(this.buffer);
  }

  public int16(): number {
    const result = this.dataView.getInt16(this.offset);
    this.offset += 2;
    return result;
  }

  public byte(): number {
    const result = this.dataView.getUint8(this.offset);
    this.offset++;
    return result;
  }

  public int32(): number {
    const result = this.dataView.getInt32(this.offset);
    this.offset += 4;
    return result;
  }

  public string(length: number): string {
    const dataView = new DataView(this.buffer, this.offset, length);
    this.offset += length;
    return this.decoder.decode(dataView);
  }

  public cstring(): string {
    const start = this.offset;
    let end = start;
    while (this.dataView.getUint8(end++) !== 0) {}
    const dataView = new DataView(this.buffer, start, end - start);
    this.offset = end;
    return this.decoder.decode(dataView);
  }

  public bytes(length: number): ArrayBuffer {
    const result = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
}
