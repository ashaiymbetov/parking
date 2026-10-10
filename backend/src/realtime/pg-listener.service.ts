import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { CHANNEL, ParkingEvent } from './events';

const MAX_RETRY_MS = 30_000;

/**
 * A dedicated connection (not from the pool) that LISTENs to domain events
 * from the API and the worker. If it drops, it reconnects with backoff and
 * emits sync.required: clients refetch, since events in between are lost.
 */
@Injectable()
export class PgListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgListener.name);
  private readonly url: string;
  private client?: Client;
  private handler?: (event: ParkingEvent) => void;
  private stopped = false;
  private retryMs = 1000;
  private retryTimer?: NodeJS.Timeout;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow<string>('DATABASE_URL');
  }

  onEvent(handler: (event: ParkingEvent) => void): void {
    this.handler = handler;
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const c = this.client;
    this.client = undefined;
    await c?.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const c = new Client({ connectionString: this.url });
    c.on('notification', (n) => {
      if (n.channel !== CHANNEL || !n.payload) return;
      try {
        this.handler?.(JSON.parse(n.payload) as ParkingEvent);
      } catch (err) {
        this.logger.error(`bad event payload: ${n.payload}`, err);
      }
    });
    c.on('error', (err) => this.lost(c, err));
    c.on('end', () => this.lost(c));
    await c.connect();
    await c.query(`LISTEN ${CHANNEL}`);
    this.client = c;
    this.retryMs = 1000;
  }

  private lost(c: Client, err?: Error): void {
    if (this.stopped || c !== this.client) return;
    this.client = undefined;
    this.logger.warn(`LISTEN connection lost${err ? `: ${err.message}` : ''}`);
    void c.end().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.connect()
        .then(() => {
          this.logger.log('LISTEN connection restored');
          this.handler?.({ type: 'sync.required' });
        })
        .catch((err: Error) => {
          this.logger.warn(`LISTEN reconnect failed: ${err.message}`);
          this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
          this.scheduleReconnect();
        });
    }, this.retryMs);
  }
}
