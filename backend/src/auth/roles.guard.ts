import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../common/domain-error';
import { AuthenticatedRequest, Role } from './auth-user';
import { ROLES_KEY } from './decorators';

/** Runs after JwtAuthGuard; checks @Roles() if present. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!roles) return true;
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user || !roles.includes(user.role)) {
      throw new DomainError(403, 'FORBIDDEN', 'Недостаточно прав');
    }
    return true;
  }
}
