import { Module } from '@nestjs/common';
import { CarsService } from './cars.service';
import { ProfileController } from './profile.controller';

@Module({
  controllers: [ProfileController],
  providers: [CarsService],
})
export class ProfileModule {}
