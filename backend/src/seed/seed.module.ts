import { Module } from '@nestjs/common';
import { DemoSeedService } from './demo-seed.service';

@Module({ providers: [DemoSeedService] })
export class SeedModule {}
