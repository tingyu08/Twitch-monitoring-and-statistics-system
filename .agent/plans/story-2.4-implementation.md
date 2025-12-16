# Story 2.4 Implementation Plan

## Phase 1: Backend Implementation

- [x] **1. Database Schema Update**

  - [x] Add `ViewerChannelLifetimeStats` model
  - [x] Add `ViewerDashboardLayout` model
  - [x] Run migration

- [x] **2. Lifetime Stats Aggregator**

  - [x] Create `src/services/lifetime-stats-aggregator.service.ts`
  - [x] Implement `calculateLifetimeStats` logic
  - [x] Implement `updatePercentileRankings` logic

- [x] **3. Cron Job**

  - [x] Create `src/jobs/update-lifetime-stats.job.ts`
  - [x] Register job in `src/jobs/index.ts`

- [x] **4. Badge & Layout Services**

  - [x] Create `src/services/badge.service.ts`
  - [x] Create `src/modules/viewer/dashboard-layout.service.ts`

- [x] **5. API Controllers & Routes**
  - [x] Create `src/modules/viewer/viewer-lifetime-stats.controller.ts`
  - [x] Create `src/modules/viewer/dashboard-layout.controller.ts`
  - [x] Update `src/modules/viewer/viewer.routes.ts`

## Phase 2: Frontend Implementation

- [x] **6. Frontend Setup**

  - [x] Install dependencies: `react-grid-layout`, `react-resizable`, `lodash.debounce`
  - [x] Create API clients:
    - [x] `src/lib/api/lifetime-stats.ts`
    - [x] `src/lib/api/dashboard-layout.ts`

- [x] **7. UI Components**

  - [x] Create `src/features/viewer-dashboard/components/BadgeDisplay.tsx`
  - [x] Create Cards:
    - [x] `TotalWatchTimeCard`
    - [x] `TotalMessagesCard`
    - [x] `TrackingDaysCard`
    - [x] `StreakCard`
    - [x] `RadarChartCard`
    - [x] `BadgesCard`
    - [x] Other small stats cards
  - [x] Create `FootprintDashboard.tsx`
    - [x] Implement React Grid Layout
    - [x] Integrate all cards
    - [x] Layout persistence logic

- [x] **8. Pages & Navigation**
  - [x] Create `src/app/dashboard/viewer/footprint/[channelId]/page.tsx`
  - [x] Add navigation entry (Button in Channel Stats Page)

## Phase 3: Testing & Polish

- [ ] **10. Tests**

  - [ ] Backend Unit Tests
  - [ ] Frontend Component Tests
  - [ ] E2E Tests

- [ ] **11. Documentation**
  - [ ] Update API docs
