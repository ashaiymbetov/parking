import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { seedDemoData } from './demo-seed';

/** Runs after TypeORM has applied migrations, only when SEED_DEMO=true. */
@Injectable()
export class DemoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get<boolean>('SEED_DEMO')) return;
    const result = await this.dataSource.transaction((m) => seedDemoData(m));
    this.logger.log(
      `Demo data: ${result.usersCreated} users, ${result.carsCreated} cars created`,
    );
  }
}
