function databaseIdentity(value: string) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected a PostgreSQL database URL');
  const database = decodeURIComponent(url.pathname.slice(1)) || decodeURIComponent(url.username);
  if (!url.hostname || !database) throw new Error('Explicit database identity is required for integration tests');
  return { host: url.hostname.toLowerCase(), port: url.port || '5432', database };
}
export function assertIsolatedTestDatabase(testUrl: string | undefined, appUrl: string | undefined): void {
  if (!testUrl) return;
  const test = databaseIdentity(testUrl);
  if (!appUrl) return;
  const app = databaseIdentity(appUrl);
  if (test.host === app.host && test.port === app.port && test.database === app.database) {
    throw new Error('Refusing integration tests against DATABASE_URL; use an isolated test database.');
  }
}
