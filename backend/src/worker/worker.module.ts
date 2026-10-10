import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClockModule } from '../clock/clock.module';
import { AppConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { Mailer, SmtpMailer } from '../mail/mailer';
import { NoShowTask } from './no-show.task';
import { OutboxTask } from './outbox.task';
import { ReminderTask } from './reminder.task';
import { SpotSnapshotTask } from './spot-snapshot.task';
import { WorkerSettings } from './worker-settings';
import { WorkerService } from './worker.service';

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    // Migrations are applied by the API; the worker starts after it is healthy.
    DatabaseModule.forRoot({ runMigrations: false }),
  ],
  providers: [
    WorkerService,
    WorkerSettings,
    NoShowTask,
    ReminderTask,
    OutboxTask,
    SpotSnapshotTask,
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SmtpMailer({
          host: config.getOrThrow<string>('SMTP_HOST'),
          port: config.getOrThrow<number>('SMTP_PORT'),
          from: config.getOrThrow<string>('MAIL_FROM'),
        }),
    },
  ],
})
export class WorkerModule {}
