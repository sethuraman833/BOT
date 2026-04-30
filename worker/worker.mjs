// ─────────────────────────────────────────────────────────
//  Worker Entry Point — Cron Scheduler
//  1. Every 15 minutes: run full scanner
//  2. Daily at 06:45 UTC (12:15 PM IST): send market context
// ─────────────────────────────────────────────────────────

import cron from 'node-cron';
import { runScan } from './scanner.mjs';
import { sendDailyReport } from './marketContext.mjs';

console.log('═══════════════════════════════════════');
console.log(' SMC TERMINAL — Background Worker v5.0');
console.log('═══════════════════════════════════════');
console.log(`Started at: ${new Date().toISOString()}`);

// Run immediately on startup
runScan();

// Every 15 minutes
cron.schedule('*/15 * * * *', () => {
  runScan();
});

// Daily at 06:45 UTC = 12:15 PM IST
cron.schedule('45 6 * * *', () => {
  console.log('[CRON] Triggering daily market context report');
  sendDailyReport();
});

console.log('[CRON] Scheduled: */15 * * * * (scanner)');
console.log('[CRON] Scheduled: 45 6 * * * (daily context @ 12:15 PM IST)');
