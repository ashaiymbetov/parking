import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { ClockModule } from './clock/clock.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ProfileModule } from './profile/profile.module';
import { SeedModule } from './seed/seed.module';
import { SpotsModule } from './spots/spots.module';

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    DatabaseModule.forRoot({ runMigrations: true }),
    HealthModule,
    SeedModule,
    AuthModule,
    ProfileModule,
    SpotsModule,
    BookingsModule,
  ],
})
export class AppModule {}
