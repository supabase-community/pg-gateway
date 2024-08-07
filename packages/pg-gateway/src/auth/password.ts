export type PasswordAuthOptions = {
  method: 'password';
  validateCredentials: (credentials: {
    user: string;
    password: string;
  }) => boolean | Promise<boolean>;
};
