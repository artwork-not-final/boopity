// The RPC boundary accepts only session lookup inputs, never a caller-asserted user.
export type SessionHeaders = {
  cookie?: string;
  ip?: string;
  userAgent?: string;
};
export type AuthIdentity = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
};
