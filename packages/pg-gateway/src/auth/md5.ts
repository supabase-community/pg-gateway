export type Md5Auth = {
  method: 'md5';
  validateCredentials: (credentials: {
    user: string;
    hash: string;
    salt: Uint8Array;
  }) => boolean | Promise<boolean>;
};
