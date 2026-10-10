import { EnableExtensions1791100486207 } from './1791100486207-EnableExtensions';
import { CreateUsersAndCars1791106420000 } from './1791106420000-CreateUsersAndCars';
import { CreateSpotsAndTariffs1791106421000 } from './1791106421000-CreateSpotsAndTariffs';
import { CreateBookings1791106422000 } from './1791106422000-CreateBookings';
import { CreateVisitsAndInvoices1791106423000 } from './1791106423000-CreateVisitsAndInvoices';
import { CreateJournalsAndOutbox1791106424000 } from './1791106424000-CreateJournalsAndOutbox';
import { SeedReferenceData1791106425000 } from './1791106425000-SeedReferenceData';
import { CreateSpotStateFunctions1791106426000 } from './1791106426000-CreateSpotStateFunctions';
import { AddJournalSequence1791106427000 } from './1791106427000-AddJournalSequence';

/**
 * Explicit list instead of a glob: works the same under ts-jest, ts-node and
 * compiled dist. Every new migration must be added here in order.
 */
export const migrations = [
  EnableExtensions1791100486207,
  CreateUsersAndCars1791106420000,
  CreateSpotsAndTariffs1791106421000,
  CreateBookings1791106422000,
  CreateVisitsAndInvoices1791106423000,
  CreateJournalsAndOutbox1791106424000,
  SeedReferenceData1791106425000,
  CreateSpotStateFunctions1791106426000,
  AddJournalSequence1791106427000,
];
