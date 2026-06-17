import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthSessionsService } from '../services/auth-sessions.service';
import { JwtTokenService } from '../services/jwt-token.service';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtTokenService: JwtTokenService,
    private readonly authSessionsService: AuthSessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException('Token de acesso não informado');
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token de acesso inválido');
    }

    const payload = this.jwtTokenService.verifyAccessToken(token);

    await this.authSessionsService.assertSessionActive(
      payload.sessionId,
      payload.sub,
    );

    request.user = {
      userId: payload.sub,
      role: payload.role,
      sessionId: payload.sessionId,
      jti: payload.jti,
    };

    return true;
  }
}
