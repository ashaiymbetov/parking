import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndCars1791106420000 implements MigrationInterface {
  name = 'CreateUsersAndCars1791106420000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email         citext NOT NULL,
        password_hash text NOT NULL,
        role          text NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT users_email_key UNIQUE (email),
        CONSTRAINT users_role_check CHECK (role IN ('driver', 'operator'))
      )
    `);

    // Plates are stored normalized (upper case, Latin, no spaces) — D-005.
    await queryRunner.query(`
      CREATE TABLE cars (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        plate      text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT cars_plate_key UNIQUE (plate),
        CONSTRAINT cars_plate_format_check
          CHECK (plate ~ '^[A-Z0-9]{1,15}$')
      )
    `);
    await queryRunner.query(`CREATE INDEX cars_user_id_idx ON cars (user_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE cars`);
    await queryRunner.query(`DROP TABLE users`);
  }
}
