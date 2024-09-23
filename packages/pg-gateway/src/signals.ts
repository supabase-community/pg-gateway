export const tlsUpgradeSignal = Symbol('tls-upgrade');
export const closeSignal = Symbol('close');

export type TlsUpgradeSignal = typeof tlsUpgradeSignal;
export type CloseSignal = typeof closeSignal;

export type ConnectionSignal = TlsUpgradeSignal | CloseSignal;
