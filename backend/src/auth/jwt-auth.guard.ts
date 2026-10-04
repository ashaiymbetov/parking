import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DomainError } from '../common/domain-error';
import { AuthenticatedRequest, JwtPayload, ROLES } from './auth-user';
import { IS_PUBLIC } from './decorators';

/** Global guard: every endpoint needs a valid Bearer token unless @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw unauthorized();
    }
    if (typeof payload.sub !== 'string' || !ROLES.includes(payload.role)) {
      throw unauthorized();
    }
    req.user = { id: payload.sub, role: payload.role };
    return true;
  }
}

function unauthorized(): DomainError {
  return new DomainError(401, 'UNAUTHORIZED', 'Требуется вход');
}
