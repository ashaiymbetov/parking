import { Request } from 'express';

export const ROLES = ['driver', 'operator'] as const;
export type Role = (typeof ROLES)[number];

/** Who is calling, taken from a verified JWT. */
export interface AuthUser {
  id: string;
  role: Role;
}

export interface JwtPayload {
  sub: string;
  role: Role;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };
