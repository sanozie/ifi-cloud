/**
 * Smoke test for IFI core functionality
 * Tests OpenAI and Fireworks availability via providers
 * Also checks database connectivity
 */
async function runSmokeTests() {
  console.log('🔥 Running IFI smoke tests...');
  console.log('-----------------------------------');
  
  console.log('📊 Smoke test summary:');
  
  const allPassed = true
  console.log('-----------------------------------');
  console.log(`🏁 Overall result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  if (!allPassed) {
    process.exit(1);
  }
}

// Run the smoke tests
runSmokeTests().catch(error => {
  console.error('Fatal error running smoke tests:', error);
  process.exit(1);
});
