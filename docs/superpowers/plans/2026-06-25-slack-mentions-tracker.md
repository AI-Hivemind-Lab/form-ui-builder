# Slack Mentions Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS menubar app that tracks Slack @mentions in real time, ranks them by AI-powered priority, and delivers reminders via macOS notifications and Slack DMs.

**Architecture:** Electron (React/TypeScript) menubar app subscribes to Supabase Realtime for live updates. Three Supabase Edge Functions handle Slack webhooks, Claude scoring, and pg_cron reminder dispatch. Slack OAuth provides tokens stored in Supabase.

**Tech Stack:** Electron 32, React 18, TypeScript 5, electron-vite 2, menubar npm package, @supabase/supabase-js 2, Supabase Edge Functions (Deno), Claude API `claude-haiku-4-5`, Vitest 2, @testing-library/react 16

## Global Constraints

- Target macOS 13+ (Ventura); Electron 32+; Node.js 20+
- Custom URL scheme: `slackmentions://oauth/callback`
- Claude model: `claude-haiku-4-5` — do not substitute
- `final_score = min(ai_score + rule_boost, 5)` — both stored separately
- `rule_boost = min(sum of all matching rule boosts, 3)`
- Slack OAuth scopes: `app_mentions:read channels:history groups:history im:write chat:write users:read`
- pg_cron schedule for `send-reminder`: `'* * * * *'` (every minute)
- All Slack tokens stored in Supabase `workspaces.bot_token` — never in Electron local storage
- Tray badge shows count of unread mentions where `final_score >= 3`
- Mention sort: unread first, then `final_score DESC`, then `created_at DESC`

---

## File Structure

```
slack-mentions-tracker/
├── package.json
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
├── electron.vite.config.ts
├── electron-builder.json5
├── vitest.config.ts
├── .env.example
├── resources/
│   └── tray-icon.png              # 16×16 menubar icon
│
├── src/
│   ├── shared/
│   │   └── ipc-channels.ts        # IPC channel name constants
│   │
│   ├── main/
│   │   ├── index.ts               # App entry, BrowserWindow, menubar setup
│   │   ├── tray.ts                # Tray icon + badge management
│   │   ├── notifications.ts       # macOS Notification wrapper
│   │   └── oauth.ts               # Custom URL scheme, Slack OAuth token exchange
│   │
│   ├── preload/
│   │   └── index.ts               # contextBridge API exposed to renderer
│   │
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx            # Root: routing between onboarding/list/settings
│           ├── types.ts           # Mention, Reminder, PriorityRule, Workspace
│           ├── env.d.ts           # window.electronAPI type declaration
│           │
│           ├── lib/
│           │   ├── supabase.ts    # Supabase client singleton
│           │   └── database.types.ts  # Generated from `supabase gen types`
│           │
│           ├── hooks/
│           │   ├── useMentions.ts    # Fetch + Realtime subscription + markAsRead
│           │   └── useReminders.ts  # setReminder + listen for fired reminders
│           │
│           └── components/
│               ├── MentionList.tsx     # Sorted list + badge update effect
│               ├── MentionRow.tsx      # Single mention card with actions
│               ├── ReminderModal.tsx   # datetime-local picker + note field
│               ├── SettingsPanel.tsx   # Tabbed container
│               ├── PriorityRulesTab.tsx # Rule CRUD
│               ├── WorkspacesTab.tsx   # Connect/disconnect workspaces
│               └── Onboarding.tsx      # First-run connect screen
│
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 20260625000000_initial.sql    # All 4 tables + Realtime + indexes
│   │   └── 20260625000001_cron.sql       # pg_cron job for send-reminder
│   └── functions/
│       ├── slack-events/index.ts         # Webhook receiver + signature verify
│       ├── process-mention/index.ts      # Claude scoring + rule boost + DB write
│       └── send-reminder/index.ts        # Due reminder dispatch (Slack DM + Realtime)
│
└── tests/
    ├── setup.ts
    ├── edge-functions/
    │   ├── slack-signature.test.ts   # HMAC verification pure function
    │   ├── rule-boost.test.ts        # computeRuleBoost pure function
    │   └── send-reminder.test.ts     # buildReminderDM pure function
    └── renderer/
        ├── MentionRow.test.tsx
        └── ReminderModal.test.tsx
```

---

### Task 1: Scaffold Electron + React + TypeScript project

**Files:**
- Create: `slack-mentions-tracker/` (entire scaffold)
- Create: `slack-mentions-tracker/electron.vite.config.ts`
- Create: `slack-mentions-tracker/electron-builder.json5`
- Create: `slack-mentions-tracker/vitest.config.ts`
- Create: `slack-mentions-tracker/tests/setup.ts`
- Create: `slack-mentions-tracker/.env.example`
- Create: `slack-mentions-tracker/src/shared/ipc-channels.ts`

**Interfaces:**
- Produces: Build config, IPC constants — consumed by Tasks 7, 8, 9, 10, 11, 12, 13

- [ ] **Step 1: Create project with electron-vite**

```bash
cd /Users/ops/Documents/vibecoding-course
npm create @quick-start/electron@latest slack-mentions-tracker -- --template react-ts
cd slack-mentions-tracker
```

Expected: Project created with `src/main/`, `src/preload/`, `src/renderer/` directories and `package.json`.

- [ ] **Step 2: Install additional dependencies**

```bash
npm install @supabase/supabase-js
npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @vitejs/plugin-react
```

Expected: Packages installed, no peer dep errors.

- [ ] **Step 3: Configure electron-builder for macOS + custom URL scheme**

Replace `electron-builder.json5` contents:

```json5
{
  appId: "com.slackmentions.app",
  productName: "Slack Mentions",
  directories: { buildResources: "build" },
  files: [
    "!**/.vscode/*",
    "!src/*",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}",
    "!{.env,.env.*,!.env.production}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}"
  ],
  mac: {
    category: "public.app-category.productivity",
    target: { target: "dmg", arch: ["arm64", "x64"] },
    protocols: [{ name: "Slack Mentions OAuth", schemes: ["slackmentions"] }]
  }
}
```

- [ ] **Step 4: Configure Vitest for renderer tests**

Create `vitest.config.ts` in project root:

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer/src'),
    },
  },
})
```

Add to `package.json` scripts section:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Create test setup file**

Create `tests/setup.ts`:

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 6: Create IPC channel constants**

Create `src/shared/ipc-channels.ts`:

```typescript
export const IPC = {
  OPEN_OAUTH: 'open-oauth',
  OAUTH_COMPLETE: 'oauth-complete',
  SHOW_NOTIFICATION: 'show-notification',
  UPDATE_BADGE: 'update-badge',
  OPEN_EXTERNAL: 'open-external',
} as const
```

- [ ] **Step 7: Create .env.example**

Create `.env.example`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SLACK_CLIENT_ID=your-slack-client-id
SLACK_CLIENT_SECRET=your-slack-client-secret
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Copy to `.env.local` and fill in real values. Ensure `.env.local` is in `.gitignore`.

- [ ] **Step 8: Create placeholder tray icon**

```bash
mkdir -p resources
# Create a minimal 16x16 PNG for development (replace before shipping)
# On macOS: use any 16x16 PNG. A simple colored square is fine for dev.
touch resources/tray-icon.png
echo "⚠️  Add a 16×16 PNG to resources/tray-icon.png before running the app"
```

- [ ] **Step 9: Verify scaffold builds**

```bash
npm run build
```

Expected: `out/` directory created. No TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git init
git add -A
git commit -m "feat: scaffold electron-vite react-ts project"
```

---

### Task 2: Supabase schema migration

**Files:**
- Create: `supabase/migrations/20260625000000_initial.sql`
- Create: `supabase/migrations/20260625000001_cron.sql`
- Create: `src/renderer/src/lib/database.types.ts` (generated)

**Interfaces:**
- Produces: PostgreSQL schema — all tables consumed by Tasks 4, 5, 6, 9, 11, 12

- [ ] **Step 1: Install Supabase CLI if not present**

```bash
brew install supabase/tap/supabase
supabase --version
```

Expected: Prints `1.x.x` or higher.

- [ ] **Step 2: Initialize Supabase in project**

```bash
supabase init
supabase link
```

Follow the `supabase link` prompt to connect to your Supabase project. Expected: `supabase/` directory created with `config.toml`.

- [ ] **Step 3: Write initial schema migration**

Create `supabase/migrations/20260625000000_initial.sql`:

```sql
create extension if not exists "pgcrypto";

create table workspaces (
  id             uuid primary key default gen_random_uuid(),
  team_id        text unique not null,
  team_name      text not null,
  bot_token      text not null,
  authed_user_id text not null,
  created_at     timestamptz default now()
);

create table mentions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  channel_id    text not null,
  channel_name  text not null,
  message_ts    text not null,
  thread_ts     text,
  sender_id     text not null,
  sender_name   text not null,
  text          text not null,
  context       jsonb default '[]',
  ai_score      smallint check (ai_score between 1 and 5),
  ai_category   text check (ai_category in ('action-needed', 'question', 'fyi', 'decision')),
  ai_reason     text,
  rule_boost    smallint not null default 0,
  final_score   smallint check (final_score between 1 and 5),
  is_read       boolean not null default false,
  created_at    timestamptz default now(),
  unique(workspace_id, message_ts)
);

create table reminders (
  id         uuid primary key default gen_random_uuid(),
  mention_id uuid not null references mentions(id) on delete cascade,
  due_at     timestamptz not null,
  note       text,
  is_fired   boolean not null default false,
  created_at timestamptz default now()
);

create table priority_rules (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type         text not null check (type in ('sender', 'channel', 'keyword')),
  value        text not null,
  boost        smallint not null check (boost between 1 and 3),
  created_at   timestamptz default now()
);

-- Enable Realtime on the two tables the Electron app subscribes to
alter publication supabase_realtime add table mentions;
alter publication supabase_realtime add table reminders;

-- Performance indexes
create index mentions_workspace_score
  on mentions(workspace_id, final_score desc, created_at desc);
create index reminders_due
  on reminders(due_at) where is_fired = false;
```

- [ ] **Step 4: Write cron migration**

Create `supabase/migrations/20260625000001_cron.sql`:

```sql
-- Requires pg_cron and pg_net extensions (enable in Supabase dashboard → Extensions)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schedule send-reminder every minute.
-- Replace YOUR_PROJECT_REF with your actual Supabase project ref (found in Settings → API).
select cron.schedule(
  'fire-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url    := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-reminder',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body   := '{}'::jsonb
  )
  $$
);
```

Before running this migration, set the `app.service_role_key` setting in Supabase:

```sql
-- Run in Supabase SQL editor (not in migration file — contains a secret)
alter database postgres set app.service_role_key = 'your-service-role-key';
```

- [ ] **Step 5: Apply migrations**

```bash
supabase db push
```

Expected: Both migrations applied. Tables visible in Supabase dashboard → Table Editor.

- [ ] **Step 6: Generate TypeScript types**

```bash
supabase gen types typescript --linked > src/renderer/src/lib/database.types.ts
```

Expected: `database.types.ts` created with `Database` interface containing all 4 tables.

- [ ] **Step 7: Commit**

```bash
git add supabase/ src/renderer/src/lib/database.types.ts
git commit -m "feat: add supabase schema migrations and generated types"
```

---

### Task 3: TypeScript types + Supabase client

**Files:**
- Create: `src/renderer/src/types.ts`
- Create: `src/renderer/src/lib/supabase.ts`

**Interfaces:**
- Produces: `Mention`, `Reminder`, `PriorityRule`, `Workspace`, `SlackMessage` types and `supabase` client — consumed by all renderer tasks (9–13)

- [ ] **Step 1: Write shared types**

Create `src/renderer/src/types.ts`:

```typescript
export interface SlackMessage {
  ts: string
  user: string
  text: string
}

export interface Workspace {
  id: string
  team_id: string
  team_name: string
  bot_token: string
  authed_user_id: string
  created_at: string
}

export interface Mention {
  id: string
  workspace_id: string
  channel_id: string
  channel_name: string
  message_ts: string
  thread_ts: string | null
  sender_id: string
  sender_name: string
  text: string
  context: SlackMessage[]
  ai_score: number | null
  ai_category: 'action-needed' | 'question' | 'fyi' | 'decision' | null
  ai_reason: string | null
  rule_boost: number
  final_score: number | null
  is_read: boolean
  created_at: string
}

export interface Reminder {
  id: string
  mention_id: string
  due_at: string
  note: string | null
  is_fired: boolean
  created_at: string
}

export interface PriorityRule {
  id: string
  workspace_id: string
  type: 'sender' | 'channel' | 'keyword'
  value: string
  boost: number
  created_at: string
}
```

- [ ] **Step 2: Write Supabase client**

Create `src/renderer/src/lib/supabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build
```

Expected: No errors on the new files.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/types.ts src/renderer/src/lib/supabase.ts
git commit -m "feat: add typescript types and supabase client"
```

---

### Task 4: `slack-events` Edge Function

**Files:**
- Create: `supabase/functions/slack-events/index.ts`
- Create: `tests/edge-functions/slack-signature.test.ts`

**Interfaces:**
- Produces: POST endpoint at `https://YOUR_PROJECT.supabase.co/functions/v1/slack-events` — URL entered in Slack app Event Subscriptions settings
- Consumes: `process-mention` Edge Function URL (invoked async internally)

- [ ] **Step 1: Write failing test for HMAC signature verification**

Create `tests/edge-functions/slack-signature.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

// Pure function mirroring the logic inside the Edge Function
async function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): Promise<boolean> {
  const baseString = `v0:${timestamp}:${body}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString))
  const expected =
    'v0=' +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  return expected === signature
}

describe('verifySlackSignature', () => {
  const SECRET = 'test-signing-secret'

  async function makeSignature(body: string, timestamp: string): Promise<string> {
    const baseString = `v0:${timestamp}:${body}`
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString))
    return 'v0=' + Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  it('returns true for a valid signature', async () => {
    const body = '{"type":"event_callback"}'
    const timestamp = '1609459200'
    const sig = await makeSignature(body, timestamp)
    expect(await verifySlackSignature(body, timestamp, sig, SECRET)).toBe(true)
  })

  it('returns false for an invalid signature', async () => {
    expect(await verifySlackSignature('body', '123', 'v0=badsig', SECRET)).toBe(false)
  })

  it('returns false when signature is for different body', async () => {
    const sig = await makeSignature('real-body', '1609459200')
    expect(await verifySlackSignature('tampered-body', '1609459200', sig, SECRET)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect PASS**

```bash
npm test tests/edge-functions/slack-signature.test.ts
```

Expected: PASS — all 3 assertions pass (crypto.subtle available in Node 20+).

- [ ] **Step 3: Write the Edge Function**

Create `supabase/functions/slack-events/index.ts`:

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2'

const SLACK_SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

async function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string
): Promise<boolean> {
  const baseString = `v0:${timestamp}:${body}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SLACK_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString))
  const expected =
    'v0=' +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  return expected === signature
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body = await req.text()
  const timestamp = req.headers.get('x-slack-request-timestamp') ?? ''
  const signature = req.headers.get('x-slack-signature') ?? ''

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) {
    return new Response('Request too old', { status: 401 })
  }

  if (!(await verifySlackSignature(body, timestamp, signature))) {
    console.error('Invalid Slack signature')
    return new Response('Unauthorized', { status: 401 })
  }

  const payload = JSON.parse(body)

  if (payload.type === 'url_verification') {
    return new Response(JSON.stringify({ challenge: payload.challenge }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const event = payload.event
  const isAppMention = event?.type === 'app_mention'
  const isDM = event?.type === 'message' && event?.channel_type === 'im'
  if (!isAppMention && !isDM) {
    return new Response('OK', { status: 200 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, bot_token')
    .eq('team_id', payload.team_id)
    .single()

  if (!workspace) {
    console.error('Unknown workspace:', payload.team_id)
    return new Response('OK', { status: 200 })
  }

  // Fetch thread context (up to 5 messages)
  let context: Array<{ ts: string; user: string; text: string }> = []
  if (event.thread_ts) {
    const repliesRes = await fetch(
      `https://slack.com/api/conversations.replies?channel=${event.channel}&ts=${event.thread_ts}&limit=6`,
      { headers: { Authorization: `Bearer ${workspace.bot_token}` } }
    )
    const repliesData = await repliesRes.json()
    if (repliesData.ok) {
      context = (repliesData.messages as Array<{ ts: string; user: string; text: string }>)
        .filter((m) => m.ts !== event.ts)
        .slice(0, 5)
        .map(({ ts, user, text }) => ({ ts, user, text }))
    }
  }

  // Resolve sender display name
  const userRes = await fetch(`https://slack.com/api/users.info?user=${event.user}`, {
    headers: { Authorization: `Bearer ${workspace.bot_token}` },
  })
  const userData = await userRes.json()
  const senderName = userData.ok ? (userData.user?.real_name ?? event.user) : event.user

  // Resolve channel name
  const chanRes = await fetch(`https://slack.com/api/conversations.info?channel=${event.channel}`, {
    headers: { Authorization: `Bearer ${workspace.bot_token}` },
  })
  const chanData = await chanRes.json()
  const channelName = chanData.ok ? (chanData.channel?.name ?? event.channel) : event.channel

  // Invoke process-mention asynchronously — return 200 immediately to Slack
  EdgeRuntime.waitUntil(
    fetch(`${SUPABASE_URL}/functions/v1/process-mention`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspace_id: workspace.id,
        channel_id: event.channel,
        channel_name: channelName,
        message_ts: event.ts,
        thread_ts: event.thread_ts ?? null,
        sender_id: event.user,
        sender_name: senderName,
        text: event.text,
        context,
      }),
    })
  )

  return new Response('OK', { status: 200 })
})
```

- [ ] **Step 4: Deploy Edge Function**

```bash
supabase functions deploy slack-events --no-verify-jwt
```

Expected: Output includes `Deployed Function slack-events` and the public URL.

- [ ] **Step 5: Set required secrets**

```bash
supabase secrets set SLACK_SIGNING_SECRET=your-signing-secret-from-slack-app-settings
```

Expected: `Secrets updated.`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/slack-events/ tests/edge-functions/slack-signature.test.ts
git commit -m "feat: add slack-events edge function with hmac verification"
```

---

### Task 5: `process-mention` Edge Function

**Files:**
- Create: `supabase/functions/process-mention/index.ts`
- Create: `tests/edge-functions/rule-boost.test.ts`

**Interfaces:**
- Consumes: POST body `{ workspace_id, channel_id, channel_name, message_ts, thread_ts, sender_id, sender_name, text, context }` from `slack-events`
- Produces: Inserts row into `mentions` with `final_score` → Supabase Realtime fires to Electron app

- [ ] **Step 1: Write failing test for rule boost calculation**

Create `tests/edge-functions/rule-boost.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

interface PriorityRule {
  type: 'sender' | 'channel' | 'keyword'
  value: string
  boost: number
}

function computeRuleBoost(
  rules: PriorityRule[],
  senderId: string,
  channelId: string,
  text: string
): number {
  let total = 0
  for (const rule of rules) {
    if (rule.type === 'sender' && rule.value === senderId) total += rule.boost
    if (rule.type === 'channel' && rule.value === channelId) total += rule.boost
    if (rule.type === 'keyword' && text.toLowerCase().includes(rule.value.toLowerCase()))
      total += rule.boost
  }
  return Math.min(total, 3)
}

describe('computeRuleBoost', () => {
  it('returns 0 when no rules match', () => {
    expect(computeRuleBoost([], 'U001', 'C001', 'hello')).toBe(0)
  })

  it('adds boost for matching sender', () => {
    const rules: PriorityRule[] = [{ type: 'sender', value: 'U001', boost: 2 }]
    expect(computeRuleBoost(rules, 'U001', 'C001', 'hello')).toBe(2)
  })

  it('adds boost for matching channel', () => {
    const rules: PriorityRule[] = [{ type: 'channel', value: 'C001', boost: 3 }]
    expect(computeRuleBoost(rules, 'U999', 'C001', 'hello')).toBe(3)
  })

  it('adds boost for matching keyword case-insensitively', () => {
    const rules: PriorityRule[] = [{ type: 'keyword', value: 'urgent', boost: 2 }]
    expect(computeRuleBoost(rules, 'U001', 'C001', 'This is URGENT')).toBe(2)
  })

  it('caps total boost at 3 when multiple rules match', () => {
    const rules: PriorityRule[] = [
      { type: 'sender', value: 'U001', boost: 2 },
      { type: 'channel', value: 'C001', boost: 2 },
      { type: 'keyword', value: 'urgent', boost: 2 },
    ]
    expect(computeRuleBoost(rules, 'U001', 'C001', 'urgent fix needed')).toBe(3)
  })
})
```

- [ ] **Step 2: Run test — expect PASS**

```bash
npm test tests/edge-functions/rule-boost.test.ts
```

Expected: PASS — all 5 assertions pass.

- [ ] **Step 3: Write the Edge Function**

Create `supabase/functions/process-mention/index.ts`:

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.30.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

interface PriorityRule {
  type: 'sender' | 'channel' | 'keyword'
  value: string
  boost: number
}

function computeRuleBoost(
  rules: PriorityRule[],
  senderId: string,
  channelId: string,
  text: string
): number {
  let total = 0
  for (const rule of rules) {
    if (rule.type === 'sender' && rule.value === senderId) total += rule.boost
    if (rule.type === 'channel' && rule.value === channelId) total += rule.boost
    if (rule.type === 'keyword' && text.toLowerCase().includes(rule.value.toLowerCase()))
      total += rule.boost
  }
  return Math.min(total, 3)
}

Deno.serve(async (req) => {
  const {
    workspace_id,
    channel_id,
    channel_name,
    message_ts,
    thread_ts,
    sender_id,
    sender_name,
    text,
    context,
  } = await req.json()

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  const { data: rules } = await supabase
    .from('priority_rules')
    .select('type, value, boost')
    .eq('workspace_id', workspace_id)

  const rule_boost = computeRuleBoost(rules ?? [], sender_id, channel_id, text)

  let ai_score: number | null = null
  let ai_category: string | null = null
  let ai_reason: string | null = null

  try {
    const contextLines = (context as Array<{ text: string }>)
      .map((m, i) => `[${i + 1}] ${m.text}`)
      .join('\n')

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `You are a priority scorer for Slack @mentions. Score the urgency of this mention.

Channel: #${channel_name}
From: ${sender_name}
Message: ${text}${contextLines ? `\n\nThread context:\n${contextLines}` : ''}

Respond with ONLY a JSON object — no markdown, no explanation:
{"score": <1-5 integer>, "category": <"action-needed"|"question"|"fyi"|"decision">, "reason": <one sentence>}

Scoring:
5 = immediate action needed, production impact, or time-sensitive decision
4 = needs response today, clear action item or direct question
3 = needs response this week, follow-up required
2 = FYI, low urgency
1 = passing mention, no action needed`,
        },
      ],
    })

    const parsed = JSON.parse((response.content[0] as { text: string }).text)
    ai_score = typeof parsed.score === 'number' ? Math.min(Math.max(Math.round(parsed.score), 1), 5) : null
    ai_category = parsed.category ?? null
    ai_reason = parsed.reason ?? null
  } catch (err) {
    console.error('Claude scoring failed:', err)
    // Mention still saved with null scores — not dropped
  }

  const final_score = ai_score !== null ? Math.min(ai_score + rule_boost, 5) : null

  const { error } = await supabase.from('mentions').upsert(
    {
      workspace_id,
      channel_id,
      channel_name,
      message_ts,
      thread_ts,
      sender_id,
      sender_name,
      text,
      context,
      ai_score,
      ai_category,
      ai_reason,
      rule_boost,
      final_score,
    },
    { onConflict: 'workspace_id,message_ts', ignoreDuplicates: true }
  )

  if (error) {
    console.error('Failed to insert mention:', error)
    return new Response('Error', { status: 500 })
  }

  return new Response('OK', { status: 200 })
})
```

- [ ] **Step 4: Deploy and set secrets**

```bash
supabase functions deploy process-mention
supabase secrets set ANTHROPIC_API_KEY=your-anthropic-api-key
```

Expected: Function deployed. `supabase secrets list` shows `ANTHROPIC_API_KEY`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-mention/ tests/edge-functions/rule-boost.test.ts
git commit -m "feat: add process-mention edge function with claude scoring"
```

---

### Task 6: `send-reminder` Edge Function

**Files:**
- Create: `supabase/functions/send-reminder/index.ts`
- Create: `tests/edge-functions/send-reminder.test.ts`

**Interfaces:**
- Consumes: `reminders` + `mentions` + `workspaces` (joined query)
- Produces: Slack DM to user; `reminders.is_fired = true` UPDATE → Supabase Realtime fires to Electron

- [ ] **Step 1: Write failing test for DM message formatting**

Create `tests/edge-functions/send-reminder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

function buildReminderDM(
  note: string | null,
  teamId: string,
  channelId: string,
  messageTs: string
): string {
  const slackUrl = `https://app.slack.com/client/${teamId}/${channelId}/p${messageTs.replace('.', '')}`
  const noteText = note ? `\n> ${note}` : ''
  return `⏰ *Reminder*${noteText}\n<${slackUrl}|Open mention in Slack>`
}

describe('buildReminderDM', () => {
  it('includes note when provided', () => {
    const msg = buildReminderDM('Check this!', 'T001', 'C001', '1234567890.000100')
    expect(msg).toContain('> Check this!')
    expect(msg).toContain('Open mention in Slack')
  })

  it('omits note section when note is null', () => {
    const msg = buildReminderDM(null, 'T001', 'C001', '1234567890.000100')
    expect(msg).not.toContain('>')
    expect(msg).toContain('Open mention in Slack')
  })

  it('builds correct Slack deep link URL', () => {
    const msg = buildReminderDM(null, 'T123', 'C456', '1234567890.000200')
    expect(msg).toContain('https://app.slack.com/client/T123/C456/p1234567890000200')
  })
})
```

- [ ] **Step 2: Run test — expect PASS**

```bash
npm test tests/edge-functions/send-reminder.test.ts
```

Expected: PASS — all 3 assertions pass.

- [ ] **Step 3: Write the Edge Function**

Create `supabase/functions/send-reminder/index.ts`:

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function buildReminderDM(
  note: string | null,
  teamId: string,
  channelId: string,
  messageTs: string
): string {
  const slackUrl = `https://app.slack.com/client/${teamId}/${channelId}/p${messageTs.replace('.', '')}`
  const noteText = note ? `\n> ${note}` : ''
  return `⏰ *Reminder*${noteText}\n<${slackUrl}|Open mention in Slack>`
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: dueReminders, error } = await supabase
    .from('reminders')
    .select(`
      id,
      note,
      mention_id,
      mentions (
        channel_id,
        message_ts,
        workspaces (
          team_id,
          bot_token,
          authed_user_id
        )
      )
    `)
    .lte('due_at', new Date().toISOString())
    .eq('is_fired', false)

  if (error) {
    console.error('Query failed:', error)
    return new Response('Error', { status: 500 })
  }

  if (!dueReminders || dueReminders.length === 0) {
    return new Response('OK', { status: 200 })
  }

  const firedIds: string[] = []

  for (const reminder of dueReminders) {
    const mention = reminder.mentions as {
      channel_id: string
      message_ts: string
      workspaces: { team_id: string; bot_token: string; authed_user_id: string }
    }
    if (!mention?.workspaces) continue

    const { team_id, bot_token, authed_user_id } = mention.workspaces
    const text = buildReminderDM(reminder.note, team_id, mention.channel_id, mention.message_ts)

    try {
      const dmRes = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bot_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: authed_user_id, text }),
      })
      const dmData = await dmRes.json()
      if (!dmData.ok) {
        console.error(`Slack DM failed for reminder ${reminder.id}:`, dmData.error)
        // Still mark as fired — macOS notification fires via Realtime UPDATE
      }
    } catch (err) {
      console.error(`Slack DM threw for reminder ${reminder.id}:`, err)
    }

    firedIds.push(reminder.id)
  }

  if (firedIds.length > 0) {
    // UPDATE triggers Supabase Realtime → Electron app fires macOS notification
    await supabase.from('reminders').update({ is_fired: true }).in('id', firedIds)
  }

  return new Response('OK', { status: 200 })
})
```

- [ ] **Step 4: Deploy**

```bash
supabase functions deploy send-reminder
```

Expected: `Deployed Function send-reminder`.

- [ ] **Step 5: Verify pg_cron job exists**

In the Supabase dashboard SQL editor, run:

```sql
select jobname, schedule, command from cron.job where jobname = 'fire-reminders';
```

Expected: One row with `schedule = '* * * * *'`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-reminder/ tests/edge-functions/send-reminder.test.ts
git commit -m "feat: add send-reminder edge function with slack dm delivery"
```

---

### Task 7: Electron main process + menubar + macOS notifications

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/tray.ts`
- Create: `src/main/notifications.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/env.d.ts`

**Interfaces:**
- Produces: IPC handlers for badge, notifications, and external links; menubar window — consumed by Tasks 8, 9, 11, 13

- [ ] **Step 1: Write notifications helper**

Create `src/main/notifications.ts`:

```typescript
import { Notification } from 'electron'

export function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body, silent: false }).show()
}
```

- [ ] **Step 2: Write tray helper**

Create `src/main/tray.ts`:

```typescript
import { Tray, nativeImage, app } from 'electron'
import path from 'path'

let tray: Tray | null = null

export function createTray(onClick: () => void): Tray {
  const iconPath = path.join(__dirname, '../../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Slack Mentions')
  tray.on('click', onClick)
  return tray
}

export function updateBadge(count: number): void {
  if (process.platform === 'darwin') {
    app.dock.setBadge(count > 0 ? String(count) : '')
  }
  tray?.setToolTip(count > 0 ? `Slack Mentions (${count} unread)` : 'Slack Mentions')
}
```

- [ ] **Step 3: Rewrite main process**

Replace `src/main/index.ts`:

```typescript
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { createTray, updateBadge } from './tray'
import { showNotification } from './notifications'
import { IPC } from '../shared/ipc-channels'

let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 420,
    height: 600,
    show: false,
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
}

app.whenReady().then(() => {
  app.dock?.hide()

  win = createWindow()

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  createTray(() => {
    if (!win) return
    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
      win.focus()
    }
  })

  win.on('blur', () => win?.hide())

  ipcMain.on(IPC.UPDATE_BADGE, (_e, count: number) => updateBadge(count))
  ipcMain.on(IPC.SHOW_NOTIFICATION, (_e, { title, body }: { title: string; body: string }) =>
    showNotification(title, body)
  )
  ipcMain.on(IPC.OPEN_EXTERNAL, (_e, url: string) => shell.openExternal(url))
})

app.on('window-all-closed', () => {
  // Keep alive as tray app
})
```

- [ ] **Step 4: Rewrite preload**

Replace `src/preload/index.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'

contextBridge.exposeInMainWorld('electronAPI', {
  updateBadge: (count: number) => ipcRenderer.send(IPC.UPDATE_BADGE, count),
  showNotification: (title: string, body: string) =>
    ipcRenderer.send(IPC.SHOW_NOTIFICATION, { title, body }),
  openExternal: (url: string) => ipcRenderer.send(IPC.OPEN_EXTERNAL, url),
  openOAuth: () => ipcRenderer.send(IPC.OPEN_OAUTH),
  onOAuthComplete: (cb: (workspaceId: string) => void) => {
    ipcRenderer.on(IPC.OAUTH_COMPLETE, (_e, workspaceId: string) => cb(workspaceId))
  },
})
```

- [ ] **Step 5: Add window.electronAPI type declaration**

Create `src/renderer/src/env.d.ts`:

```typescript
interface ElectronAPI {
  updateBadge: (count: number) => void
  showNotification: (title: string, body: string) => void
  openExternal: (url: string) => void
  openOAuth: () => void
  onOAuthComplete: (cb: (workspaceId: string) => void) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
```

- [ ] **Step 6: Build and verify**

```bash
npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/ src/preload/ src/renderer/src/env.d.ts
git commit -m "feat: add electron main process with menubar tray and ipc"
```

---

### Task 8: Slack OAuth flow

**Files:**
- Create: `src/main/oauth.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Produces: `IPC.OAUTH_COMPLETE` sent to renderer after token exchange; workspace row in Supabase — consumed by Task 13 (Onboarding)
- Consumes: `IPC.OPEN_OAUTH` from renderer (Task 7 preload); env vars SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY

- [ ] **Step 1: Write OAuth handler**

Create `src/main/oauth.ts`:

```typescript
import { shell, ipcMain, app, BrowserWindow } from 'electron'
import { createClient } from '@supabase/supabase-js'
import { IPC } from '../shared/ipc-channels'

export function registerOAuthHandlers(
  supabaseUrl: string,
  supabaseServiceKey: string,
  slackClientId: string,
  slackClientSecret: string,
  win: BrowserWindow
): void {
  if (!app.isDefaultProtocolClient('slackmentions')) {
    app.setAsDefaultProtocolClient('slackmentions')
  }

  ipcMain.on(IPC.OPEN_OAUTH, () => {
    const scopes = [
      'app_mentions:read',
      'channels:history',
      'groups:history',
      'im:write',
      'chat:write',
      'users:read',
    ].join(',')

    const url =
      `https://slack.com/oauth/v2/authorize` +
      `?client_id=${slackClientId}` +
      `&scope=${scopes}` +
      `&redirect_uri=slackmentions://oauth/callback`

    shell.openExternal(url)
  })

  // macOS fires open-url when the custom scheme URL is opened
  app.on('open-url', async (_event, url) => {
    if (!url.startsWith('slackmentions://oauth/callback')) return

    const code = new URL(url).searchParams.get('code')
    if (!code) return

    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: slackClientId,
        client_secret: slackClientSecret,
        code,
        redirect_uri: 'slackmentions://oauth/callback',
      }),
    })

    const tokenData = await tokenRes.json()
    if (!tokenData.ok) {
      console.error('OAuth token exchange failed:', tokenData.error)
      return
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: workspace, error } = await supabase
      .from('workspaces')
      .upsert(
        {
          team_id: tokenData.team.id,
          team_name: tokenData.team.name,
          bot_token: tokenData.access_token,
          authed_user_id: tokenData.authed_user.id,
        },
        { onConflict: 'team_id' }
      )
      .select('id')
      .single()

    if (error) {
      console.error('Failed to save workspace:', error)
      return
    }

    win.webContents.send(IPC.OAUTH_COMPLETE, workspace.id)
    win.show()
    win.focus()
  })
}
```

- [ ] **Step 2: Wire into main process**

In `src/main/index.ts`, add import at the top:

```typescript
import { registerOAuthHandlers } from './oauth'
```

Inside `app.whenReady().then(...)`, after `win = createWindow()` and before `createTray(...)`, add:

```typescript
const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const slackClientId = process.env.SLACK_CLIENT_ID!
const slackClientSecret = process.env.SLACK_CLIENT_SECRET!
registerOAuthHandlers(supabaseUrl, supabaseServiceKey, slackClientId, slackClientSecret, win)
```

- [ ] **Step 3: Manual Slack app configuration (one-time setup)**

In the Slack API dashboard at api.slack.com/apps:
1. Under "OAuth & Permissions" → Redirect URLs: add `slackmentions://oauth/callback`
2. Under "Event Subscriptions" → Request URL: enter `https://YOUR_PROJECT.supabase.co/functions/v1/slack-events` (Slack will verify it — the function handles the challenge)
3. Under "Event Subscriptions" → Subscribe to bot events: add `app_mention`
4. Under "OAuth & Permissions" → Bot Token Scopes: add all scopes listed in Global Constraints

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/oauth.ts src/main/index.ts
git commit -m "feat: add slack oauth flow with custom url scheme"
```

---

### Task 9: `useMentions` hook

**Files:**
- Create: `src/renderer/src/hooks/useMentions.ts`
- Create: `tests/renderer/useMentions.test.ts`

**Interfaces:**
- Consumes: `supabase` client (Task 3), `Mention` type (Task 3)
- Produces: `{ mentions: Mention[], loading: boolean, markAsRead: (id: string) => Promise<void> }` — consumed by MentionList (Task 10) and App.tsx (Task 13)

- [ ] **Step 1: Write failing test**

Create `tests/renderer/useMentions.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@renderer/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  },
}))

describe('useMentions', () => {
  it('starts loading and resolves to empty array', async () => {
    const { useMentions } = await import('@renderer/hooks/useMentions')
    const { result } = renderHook(() => useMentions())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.mentions).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test tests/renderer/useMentions.test.ts
```

Expected: FAIL — `@renderer/hooks/useMentions` not found.

- [ ] **Step 3: Implement the hook**

Create `src/renderer/src/hooks/useMentions.ts`:

```typescript
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Mention } from '../types'

export function useMentions() {
  const [mentions, setMentions] = useState<Mention[]>([])
  const [loading, setLoading] = useState(true)

  const fetchMentions = useCallback(async () => {
    const { data, error } = await supabase
      .from('mentions')
      .select('*')
      .order('is_read', { ascending: true })
      .order('final_score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (!error && data) setMentions(data as Mention[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchMentions()

    const channel = supabase
      .channel('mentions-inserts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mentions' },
        (payload) => {
          const m = payload.new as Mention
          setMentions((prev) => [m, ...prev])
          window.electronAPI?.showNotification(
            `New mention from ${m.sender_name}`,
            m.text.slice(0, 100)
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchMentions])

  const markAsRead = useCallback(async (id: string) => {
    await supabase.from('mentions').update({ is_read: true }).eq('id', id)
    setMentions((prev) => prev.map((m) => (m.id === id ? { ...m, is_read: true } : m)))
  }, [])

  return { mentions, loading, markAsRead }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test tests/renderer/useMentions.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useMentions.ts tests/renderer/useMentions.test.ts
git commit -m "feat: add useMentions hook with realtime subscription"
```

---

### Task 10: `MentionList` and `MentionRow` components

**Files:**
- Create: `src/renderer/src/components/MentionList.tsx`
- Create: `src/renderer/src/components/MentionRow.tsx`
- Create: `tests/renderer/MentionRow.test.tsx`

**Interfaces:**
- Consumes: `Mention` type (Task 3), `useMentions` return value (Task 9)
- Produces: `<MentionList>` and `<MentionRow>` — consumed by App.tsx (Task 13)

- [ ] **Step 1: Write failing test**

Create `tests/renderer/MentionRow.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mention } from '@renderer/types'

vi.stubGlobal('electronAPI', {
  openExternal: vi.fn(),
  showNotification: vi.fn(),
  updateBadge: vi.fn(),
  openOAuth: vi.fn(),
  onOAuthComplete: vi.fn(),
})

const mockMention: Mention = {
  id: '1',
  workspace_id: 'ws1',
  channel_id: 'C001',
  channel_name: 'incidents',
  message_ts: '1234567890.000100',
  thread_ts: null,
  sender_id: 'U001',
  sender_name: 'Alice',
  text: 'Can you check the deploy logs?',
  context: [],
  ai_score: 4,
  ai_category: 'action-needed',
  ai_reason: 'Direct question requiring action',
  rule_boost: 1,
  final_score: 5,
  is_read: false,
  created_at: new Date().toISOString(),
}

describe('MentionRow', () => {
  it('renders sender name and channel', async () => {
    const { MentionRow } = await import('@renderer/components/MentionRow')
    render(<MentionRow mention={mockMention} onMarkRead={vi.fn()} onSetReminder={vi.fn()} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('#incidents')).toBeInTheDocument()
  })

  it('shows score badge as P5', async () => {
    const { MentionRow } = await import('@renderer/components/MentionRow')
    render(<MentionRow mention={mockMention} onMarkRead={vi.fn()} onSetReminder={vi.fn()} />)
    expect(screen.getByText('P5')).toBeInTheDocument()
  })

  it('calls onMarkRead with mention id when row clicked', async () => {
    const { MentionRow } = await import('@renderer/components/MentionRow')
    const onMarkRead = vi.fn()
    render(<MentionRow mention={mockMention} onMarkRead={onMarkRead} onSetReminder={vi.fn()} />)
    await userEvent.click(screen.getByRole('article'))
    expect(onMarkRead).toHaveBeenCalledWith('1')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test tests/renderer/MentionRow.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement MentionRow**

Create `src/renderer/src/components/MentionRow.tsx`:

```typescript
import type { Mention } from '../types'

interface Props {
  mention: Mention
  onMarkRead: (id: string) => void
  onSetReminder: (mention: Mention) => void
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const CATEGORY_LABELS: Record<string, string> = {
  'action-needed': '⚡ action needed',
  question: '❓ question',
  fyi: 'ℹ️ fyi',
  decision: '🔑 decision',
}

export function MentionRow({ mention, onMarkRead, onSetReminder }: Props) {
  const score = mention.final_score ?? mention.ai_score
  const scoreColor = score !== null && score >= 4 ? '#e53e3e' : score !== null && score >= 3 ? '#dd6b20' : '#718096'
  const slackUrl = `slack://channel?team=${mention.workspace_id}&id=${mention.channel_id}&message=${mention.message_ts}`

  return (
    <article
      role="article"
      onClick={() => onMarkRead(mention.id)}
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid #e2e8f0',
        background: mention.is_read ? '#f8fafc' : '#fff',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {score !== null && (
          <span style={{ fontWeight: 700, fontSize: 13, color: scoreColor, minWidth: 28 }}>
            P{score}
          </span>
        )}
        <span style={{ fontWeight: 600, fontSize: 13 }}>{mention.sender_name}</span>
        <span style={{ color: '#718096', fontSize: 12 }}>#{mention.channel_name}</span>
        <span style={{ marginLeft: 'auto', color: '#a0aec0', fontSize: 11 }}>
          {relativeTime(mention.created_at)}
        </span>
      </div>

      <p style={{ margin: '4px 0', fontSize: 13, color: '#2d3748', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {mention.text}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        {mention.ai_category && (
          <span style={{ fontSize: 11, color: '#718096' }}>
            {CATEGORY_LABELS[mention.ai_category] ?? mention.ai_category}
          </span>
        )}
        {mention.rule_boost > 0 && (
          <span style={{ fontSize: 11, color: '#805ad5' }}>+{mention.rule_boost} rule</span>
        )}
        {mention.ai_reason && (
          <span style={{ fontSize: 11, color: '#a0aec0' }}>· {mention.ai_reason}</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onSetReminder(mention) }}
            title="Set reminder"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontSize: 14 }}
          >
            🔔
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); window.electronAPI?.openExternal(slackUrl) }}
            title="Open in Slack"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontSize: 14 }}
          >
            ↗
          </button>
        </div>
      </div>
    </article>
  )
}
```

- [ ] **Step 4: Implement MentionList**

Create `src/renderer/src/components/MentionList.tsx`:

```typescript
import { useEffect } from 'react'
import type { Mention } from '../types'
import { MentionRow } from './MentionRow'

interface Props {
  mentions: Mention[]
  loading: boolean
  onMarkRead: (id: string) => void
  onSetReminder: (mention: Mention) => void
}

export function MentionList({ mentions, loading, onMarkRead, onSetReminder }: Props) {
  useEffect(() => {
    const count = mentions.filter((m) => !m.is_read && (m.final_score ?? 0) >= 3).length
    window.electronAPI?.updateBadge(count)
  }, [mentions])

  if (loading) {
    return <div style={{ padding: 20, textAlign: 'center', color: '#a0aec0' }}>Loading…</div>
  }

  if (mentions.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#a0aec0' }}>
        <div style={{ fontSize: 32 }}>✓</div>
        <div style={{ marginTop: 8, fontSize: 14 }}>No mentions yet</div>
      </div>
    )
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {mentions.map((m) => (
        <MentionRow key={m.id} mention={m} onMarkRead={onMarkRead} onSetReminder={onSetReminder} />
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test tests/renderer/MentionRow.test.tsx
```

Expected: PASS — all 3 assertions pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/MentionList.tsx src/renderer/src/components/MentionRow.tsx tests/renderer/MentionRow.test.tsx
git commit -m "feat: add MentionList and MentionRow components"
```

---

### Task 11: `ReminderModal` + `useReminders` hook

**Files:**
- Create: `src/renderer/src/hooks/useReminders.ts`
- Create: `src/renderer/src/components/ReminderModal.tsx`
- Create: `tests/renderer/ReminderModal.test.tsx`

**Interfaces:**
- Consumes: `supabase` client (Task 3), `Reminder` type (Task 3)
- Produces: `{ setReminder }` hook; `<ReminderModal>` — consumed by App.tsx (Task 13)

- [ ] **Step 1: Write failing test**

Create `tests/renderer/ReminderModal.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mention } from '@renderer/types'

vi.stubGlobal('electronAPI', { openExternal: vi.fn(), showNotification: vi.fn(), updateBadge: vi.fn(), openOAuth: vi.fn(), onOAuthComplete: vi.fn() })

const mockMention: Mention = {
  id: 'mention-1', workspace_id: 'ws1', channel_id: 'C001', channel_name: 'general',
  message_ts: '1234567890.000100', thread_ts: null, sender_id: 'U001', sender_name: 'Bob',
  text: 'Can you review this?', context: [], ai_score: 3, ai_category: 'question',
  ai_reason: 'Review request', rule_boost: 0, final_score: 3, is_read: false,
  created_at: new Date().toISOString(),
}

describe('ReminderModal', () => {
  it('renders with sender name in title', async () => {
    const { ReminderModal } = await import('@renderer/components/ReminderModal')
    render(<ReminderModal mention={mockMention} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Remind me about Bob/)).toBeInTheDocument()
  })

  it('calls onClose when cancel button clicked', async () => {
    const { ReminderModal } = await import('@renderer/components/ReminderModal')
    const onClose = vi.fn()
    render(<ReminderModal mention={mockMention} onSave={vi.fn()} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test tests/renderer/ReminderModal.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement useReminders**

Create `src/renderer/src/hooks/useReminders.ts`:

```typescript
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Reminder } from '../types'

export function useReminders(onReminderFired: (reminder: Reminder) => void) {
  useEffect(() => {
    // When send-reminder marks is_fired=true, Realtime UPDATE fires here
    const channel = supabase
      .channel('reminders-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'reminders', filter: 'is_fired=eq.true' },
        (payload) => onReminderFired(payload.new as Reminder)
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [onReminderFired])

  async function setReminder(mentionId: string, dueAt: Date, note: string | null): Promise<void> {
    await supabase.from('reminders').insert({
      mention_id: mentionId,
      due_at: dueAt.toISOString(),
      note,
    })
  }

  return { setReminder }
}
```

- [ ] **Step 4: Implement ReminderModal**

Create `src/renderer/src/components/ReminderModal.tsx`:

```typescript
import { useState } from 'react'
import type { Mention } from '../types'

interface Props {
  mention: Mention
  onSave: (mentionId: string, dueAt: Date, note: string | null) => void
  onClose: () => void
}

function defaultDueAt(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)
}

export function ReminderModal({ mention, onSave, onClose }: Props) {
  const [dueAt, setDueAt] = useState(defaultDueAt())
  const [note, setNote] = useState('')

  function handleSave() {
    onSave(mention.id, new Date(dueAt), note.trim() || null)
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 8, padding: 20, width: 320, boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>
          Remind me about {mention.sender_name}
        </h3>

        <label style={{ display: 'block', fontSize: 13, color: '#718096', marginBottom: 4 }}>When</label>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
        />

        <label style={{ display: 'block', fontSize: 13, color: '#718096', marginTop: 12, marginBottom: 4 }}>Note (optional)</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Follow up on deploy"
          style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '6px 16px', border: '1px solid #e2e8f0', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{ padding: '6px 16px', border: 'none', borderRadius: 4, background: '#4a5568', color: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            Set Reminder
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test tests/renderer/ReminderModal.test.tsx
```

Expected: PASS — both assertions pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useReminders.ts src/renderer/src/components/ReminderModal.tsx tests/renderer/ReminderModal.test.tsx
git commit -m "feat: add ReminderModal and useReminders hook with realtime fired listener"
```

---

### Task 12: Settings panel

**Files:**
- Create: `src/renderer/src/components/SettingsPanel.tsx`
- Create: `src/renderer/src/components/PriorityRulesTab.tsx`
- Create: `src/renderer/src/components/WorkspacesTab.tsx`

**Interfaces:**
- Consumes: `supabase` client (Task 3), `PriorityRule`, `Workspace` types (Task 3)
- Produces: `<SettingsPanel>` — consumed by App.tsx (Task 13)

- [ ] **Step 1: Implement PriorityRulesTab**

Create `src/renderer/src/components/PriorityRulesTab.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PriorityRule } from '../types'

export function PriorityRulesTab({ workspaceId }: { workspaceId: string }) {
  const [rules, setRules] = useState<PriorityRule[]>([])
  const [type, setType] = useState<'sender' | 'channel' | 'keyword'>('sender')
  const [value, setValue] = useState('')
  const [boost, setBoost] = useState(2)

  useEffect(() => {
    supabase
      .from('priority_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .then(({ data }) => data && setRules(data as PriorityRule[]))
  }, [workspaceId])

  async function addRule() {
    if (!value.trim()) return
    const { data, error } = await supabase
      .from('priority_rules')
      .insert({ workspace_id: workspaceId, type, value: value.trim(), boost })
      .select('*')
      .single()
    if (!error && data) {
      setRules((prev) => [...prev, data as PriorityRule])
      setValue('')
    }
  }

  async function deleteRule(id: string) {
    await supabase.from('priority_rules').delete().eq('id', id)
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  const PLACEHOLDER = { sender: 'Slack user ID (e.g. U012AB3CD)', channel: 'Channel ID (e.g. C98765)', keyword: 'Keyword (e.g. urgent)' }

  return (
    <div style={{ padding: 16 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Priority Rules</h4>
      {rules.length === 0 && (
        <p style={{ fontSize: 13, color: '#a0aec0', margin: '0 0 12px' }}>No rules yet.</p>
      )}
      {rules.map((rule) => (
        <div key={rule.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: '#718096', width: 60 }}>{rule.type}</span>
          <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>{rule.value}</span>
          <span style={{ color: '#805ad5' }}>+{rule.boost}</span>
          <button onClick={() => deleteRule(rule.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 4 }}>
            <option value="sender">Sender</option>
            <option value="channel">Channel</option>
            <option value="keyword">Keyword</option>
          </select>
          <input type="text" placeholder={PLACEHOLDER[type]} value={value} onChange={(e) => setValue(e.target.value)}
            style={{ flex: 1, padding: '4px 6px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 4 }} />
          <select value={boost} onChange={(e) => setBoost(Number(e.target.value))}
            style={{ padding: '4px 6px', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 4, width: 48 }}>
            <option value={1}>+1</option>
            <option value={2}>+2</option>
            <option value={3}>+3</option>
          </select>
          <button onClick={addRule}
            style={{ padding: '4px 12px', background: '#4a5568', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement WorkspacesTab**

Create `src/renderer/src/components/WorkspacesTab.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Workspace } from '../types'

export function WorkspacesTab() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])

  useEffect(() => {
    supabase
      .from('workspaces')
      .select('id, team_id, team_name, authed_user_id, created_at')
      .then(({ data }) => data && setWorkspaces(data as Workspace[]))
  }, [])

  async function disconnectWorkspace(id: string) {
    await supabase.from('workspaces').delete().eq('id', id)
    setWorkspaces((prev) => prev.filter((w) => w.id !== id))
  }

  return (
    <div style={{ padding: 16 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Connected Workspaces</h4>
      {workspaces.length === 0 && (
        <p style={{ fontSize: 13, color: '#a0aec0', margin: '0 0 12px' }}>No workspaces connected.</p>
      )}
      {workspaces.map((ws) => (
        <div key={ws.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#48bb78', flexShrink: 0 }} />
          <span style={{ flex: 1, fontWeight: 500 }}>{ws.team_name}</span>
          <button onClick={() => disconnectWorkspace(ws.id)}
            style={{ fontSize: 12, color: '#e53e3e', background: 'none', border: '1px solid #fed7d7', borderRadius: 4, cursor: 'pointer', padding: '2px 8px' }}>
            Disconnect
          </button>
        </div>
      ))}
      <button
        onClick={() => window.electronAPI?.openOAuth()}
        style={{ marginTop: 8, padding: '6px 14px', background: '#4a154b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
        + Connect Slack Workspace
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Implement SettingsPanel**

Create `src/renderer/src/components/SettingsPanel.tsx`:

```typescript
import { useState } from 'react'
import { PriorityRulesTab } from './PriorityRulesTab'
import { WorkspacesTab } from './WorkspacesTab'

interface Props {
  workspaceId: string
  onClose: () => void
}

export function SettingsPanel({ workspaceId, onClose }: Props) {
  const [tab, setTab] = useState<'rules' | 'workspaces'>('rules')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, flex: 1 }}>Settings</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#718096', lineHeight: 1 }}>×</button>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0' }}>
        {(['rules', 'workspaces'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 600 : 400,
              borderBottom: tab === t ? '2px solid #4a5568' : '2px solid transparent', background: 'none' }}>
            {t === 'rules' ? 'Priority Rules' : 'Workspaces'}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'rules' ? <PriorityRulesTab workspaceId={workspaceId} /> : <WorkspacesTab />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SettingsPanel.tsx src/renderer/src/components/PriorityRulesTab.tsx src/renderer/src/components/WorkspacesTab.tsx
git commit -m "feat: add settings panel with priority rules and workspace tabs"
```

---

### Task 13: Onboarding + App shell

**Files:**
- Create: `src/renderer/src/components/Onboarding.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: All components from Tasks 10–12, `useMentions` (Task 9), `useReminders` (Task 11)
- Produces: Complete wired app

- [ ] **Step 1: Implement Onboarding**

Create `src/renderer/src/components/Onboarding.tsx`:

```typescript
export function Onboarding() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔔</div>
      <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Slack Mentions Tracker</h2>
      <p style={{ color: '#718096', fontSize: 14, margin: '0 0 24px', lineHeight: 1.5 }}>
        Connect your Slack workspace to start tracking @mentions, ranked by priority.
      </p>
      <button
        onClick={() => window.electronAPI?.openOAuth()}
        style={{ padding: '10px 24px', background: '#4a154b', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 15, fontWeight: 600 }}>
        Connect Slack
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite App.tsx**

Replace `src/renderer/src/App.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { useMentions } from './hooks/useMentions'
import { useReminders } from './hooks/useReminders'
import { MentionList } from './components/MentionList'
import { ReminderModal } from './components/ReminderModal'
import { SettingsPanel } from './components/SettingsPanel'
import { Onboarding } from './components/Onboarding'
import type { Mention, Reminder, Workspace } from './types'

export default function App() {
  // undefined = still loading; null = no workspace; Workspace = connected
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined)
  const [reminderTarget, setReminderTarget] = useState<Mention | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const { mentions, loading, markAsRead } = useMentions()

  const handleReminderFired = useCallback(
    (reminder: Reminder) => {
      const mention = mentions.find((m) => m.id === reminder.mention_id)
      const body = reminder.note ?? (mention ? mention.text.slice(0, 80) : 'Check Slack')
      window.electronAPI?.showNotification('⏰ Reminder', body)
    },
    [mentions]
  )

  const { setReminder } = useReminders(handleReminderFired)

  useEffect(() => {
    supabase
      .from('workspaces')
      .select('*')
      .limit(1)
      .single()
      .then(({ data }) => setWorkspace((data as Workspace) ?? null))
  }, [])

  useEffect(() => {
    window.electronAPI?.onOAuthComplete(async () => {
      const { data } = await supabase.from('workspaces').select('*').limit(1).single()
      if (data) setWorkspace(data as Workspace)
    })
  }, [])

  if (workspace === undefined) {
    return <div style={{ padding: 20, textAlign: 'center', color: '#a0aec0', fontFamily: '-apple-system, sans-serif' }}>Loading…</div>
  }

  if (!workspace) {
    return <Onboarding />
  }

  if (showSettings) {
    return <SettingsPanel workspaceId={workspace.id} onClose={() => setShowSettings(false)} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #e2e8f0', background: '#fff', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 700, flex: 1 }}>Mentions</h1>
        <button onClick={() => setShowSettings(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#718096' }} title="Settings">
          ⚙
        </button>
      </div>

      <MentionList
        mentions={mentions}
        loading={loading}
        onMarkRead={markAsRead}
        onSetReminder={setReminderTarget}
      />

      {reminderTarget && (
        <ReminderModal
          mention={reminderTarget}
          onSave={async (mentionId, dueAt, note) => {
            await setReminder(mentionId, dueAt, note)
            setReminderTarget(null)
          }}
          onClose={() => setReminderTarget(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: All tests PASS. No TypeScript errors.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/Onboarding.tsx
git commit -m "feat: add onboarding and app shell wiring all components"
```

---

### Task 14: End-to-end verification

**Files:** None — verification only.

- [ ] **Step 1: Start dev mode**

```bash
npm run dev
```

Expected: Electron launches. App icon appears in macOS menubar. Clicking it opens the 420×600 panel.

- [ ] **Step 2: Verify Slack app config (one-time checklist)**

In the Slack API dashboard (api.slack.com/apps):
- "Event Subscriptions" → Request URL = `https://YOUR_PROJECT.supabase.co/functions/v1/slack-events` with green ✓ "Verified"
- "Event Subscriptions" → Bot events: `app_mention` is listed
- "OAuth & Permissions" → Redirect URLs: `slackmentions://oauth/callback` is listed
- "OAuth & Permissions" → Bot Token Scopes: `app_mentions:read`, `channels:history`, `groups:history`, `im:write`, `chat:write`, `users:read`

- [ ] **Step 3: Complete OAuth flow**

1. Click "Connect Slack" in the app → browser opens to Slack OAuth page
2. Authorize the app for your workspace
3. Browser redirects to `slackmentions://oauth/callback?code=...`
4. Electron intercepts, stores workspace in Supabase, sends `IPC.OAUTH_COMPLETE`
5. App transitions from Onboarding to empty mention list: "No mentions yet ✓"

- [ ] **Step 4: Test real-time mention**

In Slack, @mention yourself in any public channel. Within 2–5 seconds:
- macOS notification fires: "New mention from [your name]"
- Mention appears at the top of the list with a priority score and category

- [ ] **Step 5: Test reminder**

1. Click 🔔 on a mention
2. Set due time to 1–2 minutes from now, add a note, click "Set Reminder"
3. Wait for the time
4. Expected: macOS notification "⏰ Reminder" fires; Slack DM from the bot arrives

- [ ] **Step 6: Test priority rules**

1. Open Settings (⚙) → Priority Rules
2. Add a rule: type=keyword, value=urgent, boost=+2
3. In Slack, @mention yourself with the word "urgent" in the message
4. Expected: mention appears with `rule_boost = 2` and `+2 rule` label

- [ ] **Step 7: Package for distribution**

```bash
npm run build
npm run package
```

Expected: `dist/` contains a `.dmg` file for macOS.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete slack mentions tracker - verified e2e"
```

---

## Summary

14 tasks covering the full stack:

| Phase | Tasks | Deliverable |
|---|---|---|
| Scaffold | 1–3 | Project, schema, types |
| Backend | 4–6 | All 3 Edge Functions deployed |
| Electron core | 7–8 | Menubar app + OAuth |
| React UI | 9–13 | All screens wired |
| Verification | 14 | End-to-end tested |
