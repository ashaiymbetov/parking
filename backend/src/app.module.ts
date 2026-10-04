import { Module } from '@nestjs/common';
import { ClockModule } from './clock/clock.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    DatabaseModule.forRoot({ runMigrations: true }),
    HealthModule,
  ],
})
export class AppModule {}
