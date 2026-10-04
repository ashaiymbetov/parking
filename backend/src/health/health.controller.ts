import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthReport, HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async get(): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== 'ok') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
