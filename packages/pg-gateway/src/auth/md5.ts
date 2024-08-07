export type Md5AuthOptions = {
  method: 'md5';
  validateCredentials: (credentials: {
    user: string;
    hash: string;
    salt: Uint8Array;
  }) => boolean | Promise<boolean>;
};
