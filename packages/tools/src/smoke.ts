/**
 * Smoke test for IFI core functionality
 * Tests OpenAI and Fireworks availability via providers
 * Also checks database connectivity
 */
import { providers } from '@ifi/providers';
import { prisma } from '@ifi/db';

async function testOpenAI() {
  console.log('Testing OpenAI planner...');
  try {
    const result = await providers.plan('Create a simple React component that displays a counter with increment and decrement buttons.');
    console.log('✅ OpenAI planner test successful');
    console.log('Sample output:');
    console.log('---');
    console.log(result.slice(0, 200) + '...');
    console.log('---');
    return true;
  } catch (error) {
    console.error('❌ OpenAI planner test failed:', (error as Error).message);
    return false;
  }
}

async function testFireworks() {
  console.log('Testing Fireworks codegen...');
  try {
    const result = await providers.codegen('Create a TypeScript function that sorts an array of objects by a specified property.');
    console.log('✅ Fireworks codegen test successful');
    console.log('Sample output:');
    console.log('---');
    console.log(result.slice(0, 200) + '...');
    console.log('---');
    return true;
  } catch (error) {
    console.error('❌ Fireworks codegen test failed:', (error as Error).message);
    return false;
  }
}

async function testDatabase() {
  console.log('Testing database connection...');
  try {
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Database connection test successful');
    console.log('Query result:', result);
    return true;
  } catch (error) {
    console.error('❌ Database connection test failed:', (error as Error).message);
    return false;
  }
}

async function runSmokeTests() {
  console.log('🔥 Running IFI smoke tests...');
  console.log('-----------------------------------');
  
  const openaiResult = await testOpenAI();
  console.log('-----------------------------------');
  
  const fireworksResult = await testFireworks();
  console.log('-----------------------------------');
  
  const dbResult = await testDatabase();
  console.log('-----------------------------------');
  
  console.log('📊 Smoke test summary:');
  console.log(`OpenAI planner: ${openaiResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Fireworks codegen: ${fireworksResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Database connection: ${dbResult ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = openaiResult && fireworksResult && dbResult;
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
