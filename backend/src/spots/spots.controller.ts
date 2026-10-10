import { Controller, Get, Query } from '@nestjs/common';
import { PeriodQueryDto } from '../bookings/dto/create-booking.dto';
import { SpotsService, SpotView, SpotWithState } from './spots.service';

@Controller('spots')
export class SpotsController {
  constructor(private readonly spots: SpotsService) {}

  @Get()
  list(): Promise<SpotWithState[]> {
    return this.spots.list();
  }

  @Get('availability')
  available(@Query() q: PeriodQueryDto): Promise<SpotView[]> {
    return this.spots.available(q.from, q.to);
  }
}
