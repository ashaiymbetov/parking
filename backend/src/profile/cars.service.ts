import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { DomainError } from '../common/domain-error';
import { pgError } from '../common/pg-error';
import { normalizePlate } from '../plates/normalize-plate';

export interface CarView {
  id: string;
  plate: string;
}

@Injectable()
export class CarsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  list(userId: string, m: EntityManager = this.ds.manager): Promise<CarView[]> {
    return m.query(
      `SELECT id, plate FROM cars WHERE user_id = $1 ORDER BY created_at, plate`,
      [userId],
    );
  }

  async add(userId: string, rawPlate: string): Promise<CarView> {
    const plate = normalizePlate(rawPlate);
    if (!plate) {
      throw new DomainError(
        422,
        'INVALID_PLATE',
        'Номер может содержать только латинские буквы, кириллические буквы-двойники (А В Е К М Н О Р С Т У Х) и цифры',
      );
    }

    try {
      const rows: CarView[] = await this.ds.query(
        `INSERT INTO cars (user_id, plate) VALUES ($1, $2) RETURNING id, plate`,
        [userId, plate],
      );
      return rows[0];
    } catch (err) {
      if (pgError(err)?.constraint === 'cars_plate_key') {
        throw await this.plateConflict(userId, plate);
      }
      throw err;
    }
  }

  async remove(userId: string, carId: string): Promise<void> {
    await this.ds.transaction(async (m) => {
      const car: unknown[] = await m.query(
        `SELECT 1 FROM cars WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [carId, userId],
      );
      if (car.length === 0) throw carNotFound();

      // Bookings and visits keep their history; such a car stays (D-026).
      const history: unknown[] = await m.query(
        `SELECT 1 FROM bookings WHERE car_id = $1
         UNION ALL SELECT 1 FROM visits WHERE car_id = $1
         LIMIT 1`,
        [carId],
      );
      if (history.length > 0) {
        throw new DomainError(
          409,
          'CAR_HAS_HISTORY',
          'У машины есть брони или визиты — её нельзя удалить',
        );
      }
      await m.query(`DELETE FROM cars WHERE id = $1`, [carId]);
    });
  }

  private async plateConflict(
    userId: string,
    plate: string,
  ): Promise<DomainError> {
    const owner: { user_id: string }[] = await this.ds.query(
      `SELECT user_id FROM cars WHERE plate = $1`,
      [plate],
    );
    return owner[0]?.user_id === userId
      ? new DomainError(
          409,
          'CAR_ALREADY_ADDED',
          `Машина ${plate} уже есть в профиле`,
        )
      : new DomainError(
          409,
          'PLATE_TAKEN',
          `Номер ${plate} привязан к другому профилю`,
        );
  }
}

export function carNotFound(): DomainError {
  return new DomainError(404, 'CAR_NOT_FOUND', 'Машина не найдена');
}
