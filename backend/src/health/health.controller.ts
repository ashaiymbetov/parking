import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { HealthReport, HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 200 or 503 with the same body shape; not routed through the error filter. */
  @Get()
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
