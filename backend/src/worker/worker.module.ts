import { Module } from '@nestjs/common';
import { ClockModule } from '../clock/clock.module';
import { AppConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { WorkerService } from './worker.service';

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    // Migrations are applied by the API; the worker starts after it is healthy.
    DatabaseModule.forRoot({ runMigrations: false }),
  ],
  providers: [WorkerService],
})
export class WorkerModule {}
