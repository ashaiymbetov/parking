import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Clock } from '../clock/clock';

/**
 * Polling loop. Every tick derives "what is due" from the database, so no
 * state lives in memory and a restart loses nothing. Domain tasks (no-show,
 * reminders, outbox, spot snapshot) will be added to `tick()` in later stages.
 */
@Injectable()
export class WorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WorkerService.name);
  private readonly pollMs: number;
  private stopping = false;
  private sleepTimer?: NodeJS.Timeout;
  private wakeUp?: () => void;
  private loopDone?: Promise<void>;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.pollMs = config.getOrThrow<number>('WORKER_POLL_MS');
  }

  onApplicationBootstrap(): void {
    this.logger.log(`Worker started, polling every ${this.pollMs} ms`);
    this.loopDone = this.loop();
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Stopping worker (${signal ?? 'shutdown'})`);
    this.stopping = true;
    clearTimeout(this.sleepTimer);
    this.wakeUp?.();
    // Let the current tick finish its transaction before the pool closes.
    await this.loopDone;
  }

  /** One pass over all periodic tasks. Public so tests can drive it. */
  async tick(): Promise<void> {
    await this.dataSource.query('SELECT 1');
    this.logger.debug(`tick at ${this.clock.now().toISOString()}`);
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.tick();
      } catch (err) {
        // A failed tick (e.g. DB restart) must not kill the worker.
        this.logger.error(
          'tick failed',
          err instanceof Error ? err.stack : err,
        );
      }
      await this.sleep();
    }
  }

  private sleep(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      this.wakeUp = resolve;
      this.sleepTimer = setTimeout(resolve, this.pollMs);
    });
  }
}
