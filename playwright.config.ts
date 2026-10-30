import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3000', channel: 'msedge', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npm.cmd run dev', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI, timeout: 120000 },
    { command: 'npx.cmd vite --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173/tests/e2e/harness.html', reuseExistingServer: !process.env.CI },
  ],
});
