import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Clock } from '../clock/clock';

export interface HealthReport {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  time: string;
}

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async check(): Promise<HealthReport> {
    const time = this.clock.now().toISOString();
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', db: 'up', time };
    } catch {
      return { status: 'error', db: 'down', time };
    }
  }
}
