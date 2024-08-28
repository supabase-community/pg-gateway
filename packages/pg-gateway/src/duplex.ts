export interface Duplex<T = unknown> {
  readable: ReadableStream<T>;
  writable: WritableStream<T>;
}
