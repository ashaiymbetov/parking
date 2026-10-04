import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthResult, AuthService } from './auth.service';
import { Public } from './decorators';
import { LoginDto, RegisterDto } from './dto/register.dto';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Self-registration creates a driver; operators come from the seed. */
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.auth.register(dto.email, dto.password);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.auth.login(dto.email, dto.password);
  }
}
