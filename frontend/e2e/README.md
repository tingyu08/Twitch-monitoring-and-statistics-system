# E2E Testing with Playwright

This directory contains end-to-end tests for the Twitch Analytics Dashboard.

## Test Files

### 1. `auth.spec.ts` - Authentication Flow Tests

- Login page display and accessibility
- Protected route redirects
- Loading states during authentication

### 2. `dashboard-navigation.spec.ts` - Dashboard Navigation Tests

- Dashboard loading with mocked authentication
- User profile information display
- Logout functionality

### 3. `dashboard-charts.spec.ts` - Charts and Data Visualization Tests

- Summary statistics rendering
- Time series chart visualization
- Heatmap chart rendering
- Tooltip interactions
- Error handling
- Loading states

## Running Tests

### Run all E2E tests

```bash
npm run test:e2e
```

### Run with UI mode (interactive)

```bash
npm run test:e2e:ui
```

### Run in debug mode

```bash
npm run test:e2e:debug
```

### View HTML report

```bash
npm run test:e2e:report
```

### Run specific test file

```bash
npx playwright test auth.spec.ts
```

### Run tests in headed mode (see browser)

```bash
npx playwright test --headed
```

## Test Strategy

### Mocked Authentication

Tests use mocked authentication to avoid requiring real Twitch OAuth:

- Cookies are set to simulate logged-in state
- API endpoints are intercepted and return mock data
- Tests focus on UI behavior and user flows

### API Mocking

All external API calls are mocked using Playwright's route interception:

- `/api/auth/me` - Returns test user data
- `/api/streamer/summary` - Returns mock statistics
- `/api/streamer/time-series` - Returns mock time series data
- `/api/streamer/heatmap` - Returns mock heatmap data

### Test Coverage

Current E2E tests cover:

- Authentication flow (4 tests)
- Dashboard navigation (3 tests)
- Chart rendering and interactions (7 tests)
- Error handling
- Loading states
- Accessibility checks

Total: **14 E2E tests**

## Configuration

See `playwright.config.ts` in the root directory for configuration details:

- Base URL: `http://localhost:3000`
- Browser: Chromium (Desktop Chrome)
- Automatic dev server start
- Screenshot on failure
- Trace on first retry

## Best Practices

1. **Use meaningful selectors**: Prefer role-based selectors (`getByRole`) over CSS selectors
2. **Mock external dependencies**: Always mock API calls to ensure test reliability
3. **Wait for load states**: Use `waitForLoadState('networkidle')` when waiting for data
4. **Handle timing issues**: Use appropriate timeouts and expect conditions
5. **Test accessibility**: Include keyboard navigation and ARIA attribute checks

## Debugging

### Visual debugging

```bash
npm run test:e2e:ui
```

### Debug specific test

```bash
npx playwright test --debug auth.spec.ts
```

### View traces

After a test failure, view the trace:

```bash
npx playwright show-trace trace.zip
```

## CI/CD Integration

The tests are configured to run in CI environments:

- `retries: 2` - Retry failed tests twice in CI
- `workers: 1` - Run tests serially in CI to avoid conflicts
- Screenshots and traces are automatically captured on failure

## Adding New Tests

1. Create a new `.spec.ts` file in the `e2e/` directory
2. Follow the existing test structure:
   - Use `test.describe()` to group related tests
   - Mock authentication in `beforeEach` if needed
   - Mock API endpoints as required
   - Use meaningful test descriptions
3. Run the test to verify it works
4. Update this README with the new test coverage

## Troubleshooting

### Tests timing out

- Increase timeout in test: `test('...', async ({ page }) => { test.setTimeout(60000); ... })`
- Check if dev server is starting correctly
- Verify API mocks are set up before navigation

### Element not found

- Check selector specificity
- Wait for load state: `await page.waitForLoadState('networkidle')`
- Use `.or()` for flexible selectors
- Add explicit waits: `await expect(element).toBeVisible({ timeout: 5000 })`

### Authentication issues

- Verify cookie domain matches test environment
- Check API mock responses match expected format
- Ensure auth state is set in `beforeEach`
