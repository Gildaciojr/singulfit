import type { Request } from 'express';
import type { AuthenticatedUser } from './jwt-auth-payload.interface';

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
