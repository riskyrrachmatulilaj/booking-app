import { describe, expect, it } from 'vitest';
import { assertIsolatedTestDatabase } from './helpers/database-safety';

describe('test database isolation guard', () => {
  it.each([
    ['postgresql://user@localhost/booking', 'postgresql://user@localhost:5432/booking'],
    ['postgresql://user@localhost:5432/booking', 'postgresql://user@localhost/booking'],
    ['postgresql://other:secret@localhost/booking', 'postgres://user@localhost/booking'],
    ['postgresql://user@localhost/%62ooking', 'postgresql://user@localhost/booking'],
    ['postgresql://booking@localhost', 'postgresql://user@localhost/booking'],
    ['postgresql://user@LOCALHOST/booking', 'postgresql://user@localhost/booking'],
  ])('rejects equivalent database identity: %s versus %s', (testUrl, appUrl) => {
    expect(() => assertIsolatedTestDatabase(testUrl, appUrl)).toThrow('Refusing integration tests against DATABASE_URL');
  });
  it.each([
    ['postgresql://user@localhost/booking_test', 'postgresql://user@localhost/booking'],
    ['postgresql://user@localhost:5433/booking', 'postgresql://user@localhost/booking'],
    ['postgresql://user@otherhost/booking', 'postgresql://user@localhost/booking'],
  ])('allows distinct database identity: %s versus %s', (testUrl, appUrl) => {
    expect(() => assertIsolatedTestDatabase(testUrl, appUrl)).not.toThrow();
  });
  it('allows absent test URL so the integration suite can report blocked', () => {
    expect(() => assertIsolatedTestDatabase(undefined, 'postgresql://user@localhost/booking')).not.toThrow();
  });
});
