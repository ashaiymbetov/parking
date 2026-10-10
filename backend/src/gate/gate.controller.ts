import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../auth/decorators';
import { DomainError } from '../common/domain-error';
import { GateRequestDto } from './dto/gate.dto';
import { GateKind, GateResponse, GateService } from './gate.service';

const MAX_KEY_LENGTH = 200;

@Controller('gate')
@Roles('operator')
export class GateController {
  constructor(private readonly gate: GateService) {}

  @Post('entry')
  entry(
    @Body() dto: GateRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    return this.run('entry', dto, key, res);
  }

  @Post('exit')
  exit(
    @Body() dto: GateRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    return this.run('exit', dto, key, res);
  }

  private async run(
    kind: GateKind,
    dto: GateRequestDto,
    key: string | undefined,
    res: Response,
  ): Promise<unknown> {
    if (
      key !== undefined &&
      (key.length === 0 || key.length > MAX_KEY_LENGTH)
    ) {
      throw new DomainError(
        422,
        'VALIDATION_FAILED',
        `Idempotency-Key: от 1 до ${MAX_KEY_LENGTH} символов`,
      );
    }
    const out: GateResponse = await this.gate.handle(kind, dto.plate, key);
    if (out.status >= 400) {
      const { code, message } = out.body as { code: string; message: string };
      throw new DomainError(out.status, code, message);
    }
    res.status(out.status);
    return out.body;
  }
}
