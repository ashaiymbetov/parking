import { Module } from '@nestjs/common';
import { OperatorController, VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  controllers: [VisitsController, OperatorController],
  providers: [VisitsService],
})
export class VisitsModule {}
