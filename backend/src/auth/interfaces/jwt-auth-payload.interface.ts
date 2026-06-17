import { UserRole } from '@prisma/client';

export type JwtTokenType = 'access' | 'refresh';

export interface JwtAuthPayload {
  sub: string;
  role: UserRole;
  sessionId: string;
  jti: string;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
  tokenType: JwtTokenType;
}

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  sessionId: string;
  jti: string;
}
