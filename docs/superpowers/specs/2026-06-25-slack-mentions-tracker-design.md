# Slack Mentions Tracker — Design Spec
_Date: 2026-06-25_

## Overview

A macOS menubar app that ingests Slack @mentions in real time, uses Claude to score and summarize each one, lets the user set reminders, and delivers notifications via both macOS system alerts and Slack DMs.

---

## Architecture

Four components:

| Component | Role |
|---|---|
| Electron desktop app (React) | Menubar UI, Supabase Realtime subscriber, macOS notifications |
| Supabase (Edge Functions + PostgreSQL + Realtime) | Webhook receiver, AI processing, storage, reminder cron |
| Slack (Events API + OAuth + Bot) | Source of mention events, delivery channel for reminder DMs |
| Claude API (`claude-haiku-4-5`) | Urgency scoring, category classification, reason generation |

### Real-time flow

```
User @mentioned in Slack
  → Slack POSTs to slack-events Edge Function
  → Edge Function fetches thread context (up to 5 messages)
  → Invokes process-mention async, returns 200 immediately
  → process-mention calls Claude → scores mention → writes to DB
  → Supabase Realtime pushes new row to Electron app
  → macOS notification fires + mention appears ranked in panel
```

### Reminder flow

```
User sets reminder on a mention (due_at + optional note)
  → pg_cron fires send-reminder Edge Function every minute
  → Finds due reminders (due_at <= now, is_fired = false)
  → Sends Slack DM via bot token
  → Inserts into Realtime notifications channel → macOS notification
  → Marks reminder is_fired = true
```

---

## Data Model

### `workspaces`
```sql
id            uuid primary key
team_id       text unique not null      -- Slack team ID
team_name     text not null
bot_token     text not null             -- xoxb-... (encrypted at rest)
authed_user_id text not null            -- Slack user ID of the authorizing user
created_at    timestamptz default now()
```

### `mentions`
```sql
id              uuid primary key
workspace_id    uuid references workspaces
channel_id      text not null
channel_name    text not null
message_ts      text not null
thread_ts       text                    -- null if not in a thread
sender_id       text not null
sender_name     text not null
text            text not null
context         jsonb                   -- array of up to 5 surrounding messages
ai_score        int2                    -- 1–5, null if Claude call failed
ai_category     text                    -- action-needed | question | fyi | decision
ai_reason       text                    -- one-line explanation from Claude
rule_boost      int2 default 0          -- points added by matching priority rules
final_score     int2                    -- ai_score + rule_boost, capped at 5
is_read         bool default false
created_at      timestamptz default now()

unique(workspace_id, message_ts)        -- deduplication
```

### `reminders`
```sql
id          uuid primary key
mention_id  uuid references mentions
due_at      timestamptz not null
note        text
is_fired    bool default false
created_at  timestamptz default now()
```

### `priority_rules`
```sql
id            uuid primary key
workspace_id  uuid references workspaces
type          text not null   -- sender | channel | keyword
value         text not null   -- Slack user ID | channel ID | keyword string
boost         int2 not null   -- 1–3
created_at    timestamptz default now()
```

---

## Backend: Edge Functions

### `slack-events` (POST /slack-events)

1. Verify Slack request signature (HMAC-SHA256 over request body + timestamp). Reject with 401 if invalid.
2. Handle `url_verification` challenge — return `{challenge}` immediately.
3. Filter events: accept `app_mention` and DM `message` events only.
4. Fetch up to 5 surrounding thread messages via `conversations.replies`.
5. Invoke `process-mention` asynchronously.
6. Return HTTP 200 within 3 seconds (Slack requirement).

### `process-mention`

1. Build Claude prompt: message text + thread context + channel name + sender name.
2. Call `claude-haiku-4-5` with structured output: `{score: 1-5, category: string, reason: string}`.
3. Load `priority_rules` for the workspace, compute `rule_boost` (sum of matching boosts, cap at 3).
4. Write `mention` row: `final_score = min(ai_score + rule_boost, 5)`.
5. If Claude call fails: write mention with `ai_score = null`, `final_score = null` — displayed unscored in UI, not dropped.

### `send-reminder` (pg_cron: every minute)

1. Query `reminders` where `due_at <= now()` and `is_fired = false`.
2. For each due reminder:
   - POST Slack DM to `authed_user_id` via bot token: "Reminder: [note] — [Slack deep link to message]"
   - Insert row into `notifications` Realtime channel to trigger macOS notification in Electron.
   - If Slack DM fails (e.g. revoked token): log error, still fire macOS notification.
3. Batch-update `is_fired = true`.

---

## Electron App

### Tech stack
- Electron + React + TypeScript
- `electron-menubar` for menubar/tray integration
- Supabase JS client (Realtime + DB)
- `node-notifier` or Electron's built-in `Notification` API for macOS notifications

### Screens

**Menubar icon**
- Badge shows count of unread mentions with `final_score >= 3`
- Click opens the main panel

**Main panel — mention list**
- Sorted by `final_score` descending, then `created_at` descending
- Unread mentions surfaced above read ones
- Each row shows: sender name, channel name, message preview (truncated), AI score badge, category chip, AI reason, relative timestamp
- Rule boost indicator if `rule_boost > 0`
- Actions per row: `[Set Reminder]` opens reminder modal, `[Open in Slack]` deep-links to thread, click row marks as read

**Reminder modal**
- Date + time picker (defaults to +1 hour)
- Optional note field
- Save / Cancel

**Settings panel — two tabs**
- *Priority Rules*: list of rules with type/value/boost; add rule form; delete button per rule
- *Workspaces*: connected workspaces with disconnect button; "Connect Slack" OAuth button for adding new workspace

**First-run onboarding**
- Shown when no workspaces connected
- Single "Connect Slack" button → opens browser for OAuth flow → redirect back to Electron via custom URL scheme (`slackmentions://oauth/callback`)

### Supabase Realtime subscriptions
- `mentions` table INSERT → update list, fire macOS notification
- `notifications` table INSERT (from send-reminder) → fire macOS notification for due reminder

---

## Priority Scoring

```
final_score = min(ai_score + rule_boost, 5)
```

**Claude scoring criteria (in prompt):**
- 5 — requires immediate action, production impact, time-sensitive decision
- 4 — needs response today, clear action item or question directed at you
- 3 — needs response this week, informational with follow-up required
- 2 — FYI, low urgency, no action needed soon
- 1 — noise, passing mention, no action needed

**Rule boost examples:**
- Sender `@manager` → +2
- Channel `#incidents` → +3
- Keyword `"urgent"` → +2

Boosts stack but are capped: `rule_boost = min(sum_of_matching_boosts, 3)`.

---

## Slack OAuth Setup

1. User clicks "Connect Slack" in Electron
2. Electron opens browser to Slack OAuth URL with scopes:
   - `app_mentions:read` — receive @mention events
   - `channels:history` — fetch thread context
   - `groups:history` — fetch thread context in private channels
   - `im:write` + `chat:write` — send reminder DMs
   - `users:read` — resolve sender names
3. Slack redirects to `slackmentions://oauth/callback?code=...`
4. Electron intercepts via custom protocol, exchanges code for tokens
5. Stores `bot_token` + `authed_user_id` in `workspaces` table
6. Registers Slack Events API webhook URL (Supabase Edge Function URL)

---

## Error Handling

| Failure | Behavior |
|---|---|
| Invalid Slack signature | Edge Function returns 401, logs attempt |
| Claude API unavailable | Mention stored with `ai_score = null`, shown unscored in UI |
| Duplicate `message_ts` | DB unique constraint rejects silently (idempotent) |
| Slack DM send fails | Log error, still fire macOS notification for reminder |
| Supabase Realtime disconnect | Electron reconnects automatically via Supabase JS client |
| Revoked Slack token | Show workspace as "disconnected" in Settings, prompt re-auth |

---

## Out of Scope

- Multi-user / team sharing of the mention list
- Mobile notifications
- Mention search / history beyond what's in the DB
- Slack channel message browsing (only @mentions are tracked)
