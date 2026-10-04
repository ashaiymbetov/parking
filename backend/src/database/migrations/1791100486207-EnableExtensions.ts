import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Infrastructure only, no domain tables yet.
 * btree_gist — for EXCLUDE constraints mixing `=` and `&&` (bookings);
 * citext — case-insensitive emails.
 */
export class EnableExtensions1791100486207 implements MigrationInterface {
  name = 'EnableExtensions1791100486207';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS citext`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS btree_gist`);
  }
}
