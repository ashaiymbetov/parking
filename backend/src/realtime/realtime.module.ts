import { Module } from '@nestjs/common';
import { PgListener } from './pg-listener.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({ providers: [PgListener, RealtimeGateway] })
export class RealtimeModule {}
