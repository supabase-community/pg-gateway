/**
 * PostgreSQL Parameter Types
 * @see https://github.com/postgres/postgres/blob/REL_17_STABLE/src/include/catalog/pg_type.dat
 */
export const ParameterType = {
  // Boolean
  /** Boolean type, 1 byte, true/false */
  Boolean: 16,

  // Numbers
  /** Small integer, 2 bytes, range -32768 to +32767 */
  SmallInt: 21,
  /** Integer, 4 bytes, range -2147483648 to +2147483647 */
  Integer: 23,
  /** Big integer, 8 bytes, range -9223372036854775808 to +9223372036854775807 */
  BigInt: 20,
  /** Single precision floating-point number, 4 bytes, 6 decimal digits precision */
  Real: 700,
  /** Double precision floating-point number, 8 bytes, 15 decimal digits precision */
  DoublePrecision: 701,
  /** Exact numeric with selectable precision, variable size */
  Numeric: 1700,
  /** Currency amount, 8 bytes */
  Money: 790,

  // Character Types
  /** Fixed-length single character */
  Char: 18,
  /** Fixed-length character string, blank padded */
  BpChar: 1042,
  /** Variable-length character string with limit */
  VarChar: 1043,
  /** Variable-length character string without limit */
  Text: 25,
  /** Internal type for object names, 63-byte limit */
  Name: 19,

  // Binary Data
  /** Variable-length binary string */
  ByteA: 17,

  // Date/Time
  /** Calendar date (year, month, day) */
  Date: 1082,
  /** Time of day (no time zone) */
  Time: 1083,
  /** Time of day with time zone */
  TimeWithTimeZone: 1266,
  /** Date and time (no time zone) */
  Timestamp: 1114,
  /** Date and time with time zone (timestamptz) */
  TimestampWithTimeZone: 1184,
  /** Time span/interval */
  Interval: 1186,

  // Network
  /** IPv4 and IPv6 networks */
  Cidr: 650,
  /** IPv4 and IPv6 hosts and networks */
  Inet: 869,
  /** MAC addresses (6 byte) */
  MacAddr: 829,
  /** MAC addresses (8 byte, EUI-64 format) */
  MacAddr8: 774,

  // Bit String
  /** Fixed-length bit string */
  Bit: 1560,
  /** Variable-length bit string */
  VarBit: 1562,

  // Text Search
  /** Text search document */
  TsVector: 3614,
  /** Text search query */
  TsQuery: 3615,

  // UUID
  /** Universally Unique Identifier, 128-bit value */
  Uuid: 2950,

  // XML
  /** XML data */
  Xml: 142,

  // JSON
  /** JSON data stored as text */
  Json: 114,
  /** JSON data stored in binary format, faster to process */
  JsonB: 3802,

  // Geometric
  /** Geometric point, (x,y) coordinate pair */
  Point: 600,
  /** Infinite line, linear equation ax + by + c = 0 */
  Line: 628,
  /** Finite line segment, pair of points */
  LineSegment: 601,
  /** Rectangular box, opposite corners */
  Box: 603,
  /** Closed or open path, series of points */
  Path: 602,
  /** Polygon, similar to closed path */
  Polygon: 604,
  /** Circle, center point and radius */
  Circle: 718,

  // Arrays
  /** Array of small integers (INT2) */
  SmallIntArray: 1005,
  /** Array of integers (INT4) */
  IntegerArray: 1007,
  /** Array of big integers (INT8) */
  BigIntArray: 1016,
  /** Array of text strings */
  TextArray: 1009,
  /** Array of varchar strings */
  VarCharArray: 1015,
  /** Array of binary strings */
  ByteAArray: 1001,
  /** Array of boolean values */
  BooleanArray: 1000,
  /** Array of dates */
  DateArray: 1182,
  /** Array of single precision floats */
  RealArray: 1021,
  /** Array of double precision floats */
  DoublePrecisionArray: 1022,
  /** Array of numeric values */
  NumericArray: 1231,
  /** Array of UUID values */
  UuidArray: 2951,
  /** Array of JSON values */
  JsonArray: 199,
  /** Array of JSONB values */
  JsonBArray: 3807,

  // Pseudo-Types
  /** Represents a void return type */
  Void: 2278,
  /** Represents an unspecified type */
  Unknown: 705,
} as const;
