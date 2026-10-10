import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AuthUser, Role } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { DomainError } from '../common/domain-error';
import { CarsService, CarView } from './cars.service';
import { AddCarDto } from './dto/add-car.dto';

interface MeView {
  id: string;
  email: string;
  role: Role;
  cars: CarView[];
}

@Controller('me')
export class ProfileController {
  constructor(
    private readonly cars: CarsService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthUser): Promise<MeView> {
    const rows: { id: string; email: string; role: Role }[] =
      await this.ds.query(
        `SELECT id, email::text, role FROM users WHERE id = $1`,
        [user.id],
      );
    if (rows.length === 0) {
      // Valid token for a user that no longer exists.
      throw new DomainError(401, 'UNAUTHORIZED', 'Требуется вход');
    }
    return { ...rows[0], cars: await this.cars.list(user.id) };
  }

  @Get('cars')
  @Roles('driver')
  listCars(@CurrentUser() user: AuthUser): Promise<CarView[]> {
    return this.cars.list(user.id);
  }

  @Post('cars')
  @Roles('driver')
  addCar(
    @CurrentUser() user: AuthUser,
    @Body() dto: AddCarDto,
  ): Promise<CarView> {
    return this.cars.add(user.id, dto.plate);
  }

  @Delete('cars/:id')
  @Roles('driver')
  @HttpCode(204)
  removeCar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.cars.remove(user.id, id);
  }
}
