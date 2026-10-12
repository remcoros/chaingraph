import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [
    react({
      // Wallet navigation must also work after the app's React memoization.
      // Raw JSX missed a cached Back label on the mutable navigation owner.
      include: /\/src\/App\/Workspace\/Workbenches\/Wallet\/Review\/WalletReviewPanel\.tsx$/,
      compiler: { reportDiagnostics: true },
    }),
  ],
  test: {
    execArgv: ['--no-experimental-webstorage'],
    isolate: true,
    include: [
      'src/**/*.test.{ts,tsx}',
      'server/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
    ],
    testTimeout: 20000,
    reporters: ['agent'],
  },
});
