import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Journals are read newest first. Timestamps come from the Clock and can be
 * equal (or go backwards in demo mode), so order needs its own sequence.
 */
export class AddJournalSequence1791106427000 implements MigrationInterface {
  name = 'AddJournalSequence1791106427000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['gate_events', 'anomalies']) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY`,
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX ${table}_seq_key ON ${table} (seq)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['gate_events', 'anomalies']) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN seq`);
    }
  }
}
