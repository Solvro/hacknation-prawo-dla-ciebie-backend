// import cron from 'node-cron';
// import { syncFromGovPl } from './govSync';
// import { syncFromRcl } from './rclSync';

// // Status schedulera
// let isRunning = false;
// let lastRun: Date | null = null;
// let lastResult: {
//     gov: { created: number; updated: number; errors: number };
//     rcl: { created: number; updated: number; errors: number };
// } | null = null;

// // Funkcja wykonująca synchronizację
// async function runSync(): Promise<void> {
//     if (isRunning) {
//         console.log('⚠️ Sync already in progress, skipping...');
//         return;
//     }

//     isRunning = true;
//     console.log(`\n⏰ [${new Date().toISOString()}] Starting scheduled sync...`);

//     try {
//         // Synchronizacja z gov.pl
//         console.log('\n📡 Phase 1: Synchronizing with gov.pl API...');
//         const govResult = await syncFromGovPl();

//         // Synchronizacja z RCL (legislacja.rcl.gov.pl)
//         console.log('\n📜 Phase 2: Synchronizing with RCL (legislacja.rcl.gov.pl)...');
//         const rclResult = await syncFromRcl({ pages: 3, projectsPerPage: 20 });

//         lastResult = {
//             gov: govResult,
//             rcl: rclResult
//         };
//         lastRun = new Date();
//         console.log(`\n✅ Full sync completed at ${lastRun.toISOString()}`);
//         console.log(`   Gov.pl: ${govResult.created} created, ${govResult.updated} updated, ${govResult.errors} errors`);
//         console.log(`   RCL: ${rclResult.created} created, ${rclResult.updated} updated, ${rclResult.errors} errors`);
//     } catch (err) {
//         console.error('❌ Scheduled sync failed:', err);
//         lastResult = {
//             gov: { created: 0, updated: 0, errors: 1 },
//             rcl: { created: 0, updated: 0, errors: 1 }
//         };
//     } finally {
//         isRunning = false;
//     }
// }

// // Konfiguracja harmonogramu
// // Domyślnie: co 6 godzin (o 0:00, 6:00, 12:00, 18:00)
// const CRON_SCHEDULE = process.env.SYNC_CRON || '0 */6 * * *';

// // Eksport funkcji startującej scheduler
// export function startScheduler(): void {
//     console.log(`\n📅 Starting scheduler with cron: "${CRON_SCHEDULE}"`);

//     cron.schedule(CRON_SCHEDULE, runSync, {
//         timezone: 'Europe/Warsaw'
//     });

//     console.log(`   ✅ Scheduler started successfully`);
//     console.log('   Syncs: gov.pl API + RCL (legislacja.rcl.gov.pl)');

//     // Uruchom pierwszą synchronizację po 30 sekundach od startu
//     console.log('   🔄 First sync will run in 30 seconds...\n');
//     setTimeout(runSync, 30000);
// }

// // Eksport funkcji do ręcznego uruchomienia
// export async function triggerSync(): Promise<{
//     gov: { created: number; updated: number; errors: number };
//     rcl: { created: number; updated: number; errors: number };
// }> {
//     await runSync();
//     return lastResult || {
//         gov: { created: 0, updated: 0, errors: 0 },
//         rcl: { created: 0, updated: 0, errors: 0 }
//     };
// }

// // Funkcja do synchronizacji tylko RCL
// export async function triggerRclSync(): Promise<{ created: number; updated: number; errors: number }> {
//     if (isRunning) {
//         console.log('⚠️ Sync already in progress, skipping...');
//         return { created: 0, updated: 0, errors: 0 };
//     }

//     isRunning = true;
//     try {
//         const result = await syncFromRcl({ pages: 5, projectsPerPage: 20 });
//         return result;
//     } finally {
//         isRunning = false;
//     }
// }

// // Eksport statusu
// export function getSchedulerStatus() {
//     return {
//         isRunning,
//         lastRun: lastRun?.toISOString() || null,
//         lastResult,
//         cronSchedule: CRON_SCHEDULE,
//         sources: ['gov.pl API', 'RCL (legislacja.rcl.gov.pl)']
//     };
// }

// // Uruchom scheduler jeśli wywołano bezpośrednio
// if (require.main === module) {
//     startScheduler();
// }
