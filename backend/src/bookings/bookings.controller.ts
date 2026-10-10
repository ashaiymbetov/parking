import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { BookingsService, BookingView } from './bookings.service';
import {
  CreateBookingDto,
  ListBookingsQueryDto,
} from './dto/create-booking.dto';

@Controller('bookings')
@Roles('driver')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBookingDto,
  ): Promise<BookingView> {
    return this.bookings.create(user, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: ListBookingsQueryDto,
  ): Promise<BookingView[]> {
    return this.bookings.list(user, q.status);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingView> {
    return this.bookings.get(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingView> {
    return this.bookings.cancel(user, id);
  }
}
