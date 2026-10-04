import { Module } from '@nestjs/common';
import { ClockModule } from './clock/clock.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { SeedModule } from './seed/seed.module';

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    DatabaseModule.forRoot({ runMigrations: true }),
    HealthModule,
    SeedModule,
  ],
})
export class AppModule {}
