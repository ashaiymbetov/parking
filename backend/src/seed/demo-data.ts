/** Demo accounts for local runs and manual testing. Never for production. */
export const DEMO_PASSWORD = 'parking123';

export const DEMO_USERS: ReadonlyArray<{
  email: string;
  role: 'driver' | 'operator';
  plates: readonly string[];
}> = [
  { email: 'operator@parking.local', role: 'operator', plates: [] },
  { email: 'driver1@parking.local', role: 'driver', plates: ['A123BC'] },
  {
    email: 'driver2@parking.local',
    role: 'driver',
    plates: ['B777OP', 'E001KX'],
  },
];
