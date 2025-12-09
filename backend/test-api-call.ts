import axios from 'axios';
import { generateTestToken } from './test-api';
import { prisma } from './src/db/prisma';

// API Base URL - can be configured via environment variable
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';

// Response schema interface for type checking
interface SummaryResponse {
  range: '7d' | '30d' | '90d';
  totalStreamHours: number;
  totalStreamSessions: number;
  avgStreamDurationMinutes: number;
  isEstimated: boolean;
}

// Test result tracking
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  duration: number;
  error?: string;
}

const testResults: TestResult[] = [];

/**
 * Validate response schema
 */
function validateResponse(data: any, expectedRange: string): boolean {
  if (typeof data.range !== 'string' || data.range !== expectedRange) {
    throw new Error(`Invalid range: expected ${expectedRange}, got ${data.range}`);
  }
  if (typeof data.totalStreamHours !== 'number' || data.totalStreamHours < 0) {
    throw new Error(`Invalid totalStreamHours: ${data.totalStreamHours}`);
  }
  if (typeof data.totalStreamSessions !== 'number' || data.totalStreamSessions < 0) {
    throw new Error(`Invalid totalStreamSessions: ${data.totalStreamSessions}`);
  }
  if (typeof data.avgStreamDurationMinutes !== 'number' || data.avgStreamDurationMinutes < 0) {
    throw new Error(`Invalid avgStreamDurationMinutes: ${data.avgStreamDurationMinutes}`);
  }
  if (typeof data.isEstimated !== 'boolean') {
    throw new Error(`Invalid isEstimated: ${data.isEstimated}`);
  }
  return true;
}

/**
 * Run a test and track the result
 */
async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<void> {
  const startTime = Date.now();
  try {
    await testFn();
    const duration = Date.now() - startTime;
    testResults.push({ name, status: 'PASS', duration });

    // Performance warning
    if (duration > 1000) {
      console.warn(`⚠️  Slow response: ${duration}ms (expected < 1000ms)`);
    }
  } catch (error: any) {
    const duration = Date.now() - startTime;
    testResults.push({
      name,
      status: 'FAIL',
      duration,
      error: error.message
    });
    throw error;
  }
}

async function testAPI() {
  console.log('=== Testing API Endpoints ===\n');
  console.log(`API Base URL: ${API_BASE_URL}\n`);

  let token: string;

  try {
    console.log('🔑 Generating test JWT token...');
    token = await generateTestToken();
    console.log('✅ Token generated successfully\n');
  } catch (error: any) {
    console.error('❌ Failed to generate token:', error.message);
    process.exit(1);
  }

  // Test different time ranges
  const ranges: Array<'7d' | '30d' | '90d'> = ['7d', '30d', '90d'];

  for (const range of ranges) {
    try {
      await runTest(`GET /api/streamer/me/summary?range=${range}`, async () => {
        const response = await axios.get<SummaryResponse>(
          `${API_BASE_URL}/api/streamer/me/summary?range=${range}`,
          {
            headers: {
              Cookie: `auth_token=${token}`
            }
          }
        );

        // Validate response schema
        validateResponse(response.data, range);

        console.log(`✅ GET /api/streamer/me/summary?range=${range}`);
        console.log(JSON.stringify(response.data, null, 2));
        console.log('');
      });
    } catch (error: any) {
      console.error(`❌ GET /api/streamer/me/summary?range=${range}`);

      // Check if it's a connection error
      if (error.code === 'ECONNREFUSED' || !error.response) {
        console.error('🔌 Cannot connect to API server!');
        console.error(`   Make sure the backend server is running on ${API_BASE_URL}`);
        console.error('   Run: npm run dev');
        process.exit(1);
      }

      console.error('Status:', error.response?.status);
      console.error('Data:', error.response?.data);
      console.error('Message:', error.message);
      console.log('');

      // Unexpected error (not 400 or 401) - should fail the test
      if (error.response?.status && error.response.status !== 400 && error.response.status !== 401) {
        console.error('🚨 Unexpected error status code!');
        process.exit(1);
      }
    }
  }

  // Test invalid range - should return 400
  try {
    await runTest('Invalid range parameter test', async () => {
      try {
        await axios.get(
          `${API_BASE_URL}/api/streamer/me/summary?range=invalid`,
          {
            headers: {
              Cookie: `auth_token=${token}`
            }
          }
        );
        throw new Error('Expected 400 error but request succeeded');
      } catch (error: any) {
        if (error.response?.status !== 400) {
          throw new Error(`Expected 400, got ${error.response?.status}`);
        }
        console.log('✅ Invalid range test (correctly rejected):');
        console.log(JSON.stringify(error.response?.data, null, 2));
        console.log('');
      }
    });
  } catch (error: any) {
    console.error('❌ Invalid range test failed:', error.message);
    console.log('');
  }

  // Test without auth - should return 401
  try {
    await runTest('No authentication test', async () => {
      try {
        await axios.get(`${API_BASE_URL}/api/streamer/me/summary?range=30d`);
        throw new Error('Expected 401 error but request succeeded');
      } catch (error: any) {
        if (error.response?.status !== 401) {
          throw new Error(`Expected 401, got ${error.response?.status}`);
        }
        console.log('✅ No auth test (correctly rejected):');
        console.log(JSON.stringify(error.response?.data, null, 2));
        console.log('');
      }
    });
  } catch (error: any) {
    console.error('❌ No auth test failed:', error.message);
    console.log('');
  }

  // Print summary
  printTestSummary();
}

/**
 * Print test summary
 */
function printTestSummary() {
  console.log('\n=== Test Summary ===\n');

  const passed = testResults.filter(r => r.status === 'PASS').length;
  const failed = testResults.filter(r => r.status === 'FAIL').length;
  const total = testResults.length;

  testResults.forEach(result => {
    const icon = result.status === 'PASS' ? '✅' : '❌';
    const duration = `${result.duration}ms`;
    console.log(`${icon} ${result.name} (${duration})`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
  }
}

testAPI()
  .catch((error) => {
    console.error('Test execution failed:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
