/**
 * Type of object
 * @see https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY
 */
export const Variant = {
  /** a prepared statement */
  PreparedStatement: 'S',
  /** a portal */
  Portal: 'P',
} as const;

export type VariantValue = (typeof Variant)[keyof typeof Variant];
