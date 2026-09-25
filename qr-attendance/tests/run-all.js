/**
 * Master Test Runner for QR Attendance Module
 * Executes all unit and integration test suites in memory without database mutations.
 */

import { runTokenTests } from './token.test.js';
import { runQrServiceTests } from './qrService.test.js';
import { runAttendanceServiceTests } from './attendanceService.test.js';
import { runApiTests } from './api.test.js';

async function main() {
  console.log('====================================================');
  console.log('  MSA SRM Event — QR Attendance Module Test Suite   ');
  console.log('  Mode: In-Memory Isolated Verification (Zero DB Hits)');
  console.log('====================================================');

  const startTime = Date.now();
  let passed = 0;
  let failed = 0;

  try {
    await runTokenTests();
    passed++;
  } catch (err) {
    console.error('❌ Token Tests Failed:', err);
    failed++;
  }

  try {
    await runQrServiceTests();
    passed++;
  } catch (err) {
    console.error('❌ QR Service Tests Failed:', err);
    failed++;
  }

  try {
    await runAttendanceServiceTests();
    passed++;
  } catch (err) {
    console.error('❌ Attendance Service Tests Failed:', err);
    failed++;
  }

  try {
    await runApiTests();
    passed++;
  } catch (err) {
    console.error('❌ API Integration Tests Failed:', err);
    failed++;
  }

  const duration = Date.now() - startTime;

  console.log('\n====================================================');
  console.log(`  Test Suites: ${passed} passed, ${failed} failed`);
  console.log(`  Duration:    ${duration} ms`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main();
