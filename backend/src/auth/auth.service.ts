import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DomainError } from '../common/domain-error';
import { JwtPayload, Role } from './auth-user';
import { hashPassword, verifyPassword } from './password-hasher';

export interface AuthResult {
  accessToken: string;
  user: { id: string; email: string; role: Role };
}

@Injectable()
export class AuthService {
  /** Compared against when the email is unknown, so timing does not leak it. */
  private dummyHash?: Promise<string>;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string): Promise<AuthResult> {
    const hash = await hashPassword(password);
    const rows: { id: string; email: string; role: Role }[] =
      await this.ds.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'driver')
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email::text, role`,
        [email, hash],
      );
    if (rows.length === 0) {
      throw new DomainError(
        409,
        'EMAIL_TAKEN',
        'Этот email уже зарегистрирован',
      );
    }
    return this.issue(rows[0]);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const rows: {
      id: string;
      email: string;
      role: Role;
      password_hash: string;
    }[] = await this.ds.query(
      `SELECT id, email::text, role, password_hash FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    this.dummyHash ??= hashPassword('dummy-password-for-timing');
    const ok = await verifyPassword(
      password,
      user?.password_hash ?? (await this.dummyHash),
    );
    if (!user || !ok) {
      throw new DomainError(
        401,
        'INVALID_CREDENTIALS',
        'Неверный email или пароль',
      );
    }
    return this.issue(user);
  }

  private async issue(user: {
    id: string;
    email: string;
    role: Role;
  }): Promise<AuthResult> {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
