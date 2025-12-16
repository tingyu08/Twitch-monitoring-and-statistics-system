# Story 2.3 Implementation Plan: Viewer Chat and Interaction Stats

## 1. Backend Foundation (Task 1)

### 1.1 TMI.js Setup

- [ ] Install `tmi.js` and `@types/tmi.js`
- [ ] Define environment variables in `.env.example`
  - `TWITCH_BOT_USERNAME`
  - `TWITCH_BOT_OAUTH_TOKEN`

### 1.2 Prisma Schema Update

- [ ] Add `ViewerChannelMessage` model
  - id, viewerId, channelId, messageText, messageType, timestamp, badges (Json), emotesUsed (Json), bitsAmount (Int)
- [ ] Add `ViewerChannelMessageDailyAgg` model
  - id, viewerId, channelId, date, totalMessages, chatMessages, subscriptions, cheers, giftSubs, raids, totalBits
- [ ] Run migration `prisma migrate dev --name add_viewer_messages`

### 1.3 Core Services

- [ ] Create `src/services/twitch-chat.service.ts`
  - Implement `connect`, `disconnect`, `join`, `part`
  - Handle events: `message`, `subscription`, `cheer`, `raided`
- [ ] Create `src/utils/message-parser.ts`
  - Parse `userstate` to standard format
  - Extract badges, emotes, bits

### 1.4 Data Persistence

- [ ] Create `src/modules/viewer/viewer-message.repository.ts`
  - `saveMessage`: write to detail table
  - `aggregateDailyMessages`: aggregate logic (SQL raw query or Prisma aggregate)
- [ ] Create Cron Job `src/jobs/aggregate-daily-messages.job.ts`

## 2. Backend API (Task 2 & 5 & 6)

### 2.1 Stats API

- [ ] Create `src/modules/viewer/viewer-message-stats.controller.ts`
  - `GET /api/viewer/:viewerId/channels/:channelId/message-stats`
- [ ] Create `src/modules/viewer/viewer-message-stats.service.ts`
  - Business logic to format response

### 2.2 Privacy & Control API

- [ ] `POST /api/viewer/:viewerId/privacy/pause-collection`
- [ ] `POST /api/viewer/:viewerId/privacy/clear-messages`

### 2.3 Listener Status API

- [ ] `GET /api/admin/chat-listeners/status`

## 3. Frontend Implementation (Task 3 & 4)

### 3.1 API Client

- [ ] Update `src/lib/api/viewer.ts` or create `src/lib/api/viewer-message.ts`
  - Add `getMessageStats`

### 3.2 Components

- [ ] `src/features/viewer-dashboard/components/MessageStatsSummary.tsx`
  - 4 cards: Total Messages, Avg per Stream, Most Active Date, Last Message
- [ ] `src/features/viewer-dashboard/components/MessageTrendChart.tsx`
  - Recharts BarChart
- [ ] `src/features/viewer-dashboard/components/InteractionBreakdownChart.tsx`
  - PieChart or BarChart (Horizontal)

### 3.3 Integration

- [ ] Update `src/app/dashboard/viewer/[channelId]/page.tsx`
  - Add new tab or section for "Interaction Stats"
  - Integrate new components

### 3.4 Settings Page

- [ ] Update `src/app/dashboard/viewer/settings/page.tsx`
  - Add privacy controls

## 4. Testing & Documentation (Task 7 & 8)

### 4.1 Backend Tests

- [ ] Unit tests for `message-parser.ts`
- [ ] Integration tests for API endpoints

### 4.2 Frontend Tests

- [ ] Component tests for charts and summary
- [ ] E2E tests for the new section

### 4.3 Documentation

- [ ] Update OpenAPI spec
