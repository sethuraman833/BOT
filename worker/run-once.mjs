import { runScan } from './scanner.mjs';

console.log('[RUN-ONCE] Starting single scan execution (GitHub Actions mode)...');
runScan()
  .then(() => {
    console.log('[RUN-ONCE] Execution completed successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('[RUN-ONCE] Fatal error during scan:', err);
    process.exit(1);
  });
