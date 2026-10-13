/**
 * 真页渲染取证脚本（2026-10-13-sessions-portal-header-remove 视觉证据）。
 *
 * 前置：frontend 已跑 `pnpm dev`（默认 http://localhost:3000）；
 *      本机无 backend/daemon —— `**\/api/**` 全量 route mock（固件数据）。
 * 用法：node .sillyspec/changes/2026-10-13-sessions-portal-header-remove/render-sessions-portal.mjs <out.png> [route]
 *      省略 route 默认 /sessions。
 * 原理：注入登录态 localStorage（stores/session.ts SESSION_STORAGE_KEY）→ 打开
 *      目标路由 → 等 `[data-testid=sessions-portal-panes]` 渲染 → 全视口截图；
 *      控制台错误与未命中 route 一并打印，便于复盘。
 */
import { pathToFileURL } from "node:url";

const PW = new URL(
  "../../../frontend/node_modules/@playwright/test/index.mjs",
  import.meta.url,
);
const { chromium } = await import(PW.href);

const out = process.argv[2];
const routePath = process.argv[3] ?? "/sessions";
if (!out) {
  console.error("用法: node render-sessions-portal.mjs <out.png> [route]");
  process.exit(2);
}

const iso = (minutesAgo) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

const WORKSPACE = {
  id: "ws-1",
  name: "multi-agent-platform",
  display_alias: null,
  status: "active",
  workspace_type: "root",
  root_path: "/srv/multi-agent-platform",
  created_at: iso(60 * 24 * 30),
  updated_at: iso(30),
};

const MACHINE = {
  id: "m-1",
  name: "dev-box",
  status: "online",
  last_heartbeat_at: iso(0),
  owner_user_id: "u-1",
  platform: "win32",
  daemon_version: "0.4.0",
  runtimes: [
    {
      id: "rt-1",
      machine_id: "m-1",
      provider: "claude",
      status: "online",
      display_name: "Claude Code",
      version: "2.1.0",
      capabilities: [],
      last_heartbeat_at: iso(0),
    },
  ],
};

const SESSIONS = [
  {
    id: "s-1",
    title: "整理这周的会议纪要",
    status: "running",
    session_kind: "single",
    workspace_id: "ws-1",
    change_id: null,
    runtime_id: "rt-1",
    machine_id: "m-1",
    agent_profile_id: "ap-1",
    llm_provider_id: null,
    user_id: "u-1",
    turn_count: 3,
    created_at: iso(90),
    last_active_at: iso(2),
    ended_at: null,
    deleted_at: null,
    current_run_id: null,
    terminating_at: null,
    config: null,
    config_snapshot: {
      profile_name: "知识经理",
      provider_name: null,
      model: null,
      engine: "claude",
      machine_name: "dev-box",
      agent_name: "Claude Code",
    },
    pinned: null,
    unread_count: 0,
  },
  {
    id: "s-2",
    title: "观测事件 v3 · 执行 task-07",
    status: "idle",
    session_kind: "single",
    workspace_id: "ws-1",
    change_id: null,
    runtime_id: "rt-1",
    machine_id: "m-1",
    agent_profile_id: "ap-1",
    llm_provider_id: null,
    user_id: "u-1",
    turn_count: 12,
    created_at: iso(60 * 6),
    last_active_at: iso(35),
    ended_at: null,
    deleted_at: null,
    current_run_id: null,
    terminating_at: null,
    config: null,
    config_snapshot: {
      profile_name: "知识经理",
      provider_name: null,
      model: null,
      engine: "claude",
      machine_name: "dev-box",
      agent_name: "Claude Code",
    },
    pinned: null,
    unread_count: 1,
  },
];

const ME = {
  id: "u-1",
  username: "qinyi",
  display_name: "qinyi",
  email: "qinyi@example.com",
  role: "admin",
  avatar_url: null,
  is_active: true,
  created_at: iso(60 * 24 * 90),
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
  deviceScaleFactor: 1,
});
await context.addInitScript(() => {
  window.localStorage.setItem(
    "multi-agent-platform.session",
    JSON.stringify({
      state: {
        hydrated: true,
        user: {
          id: "u-1",
          username: "qinyi",
          display_name: "qinyi",
          email: "qinyi@example.com",
          role: "admin",
          avatar_url: null,
        },
        accessToken: "e2e-fake-access-token",
        refreshToken: "e2e-fake-refresh-token",
      },
      version: 1,
    }),
  );
});

const unmatched = [];
const json = (body, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

await context.route("**/api/**", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const method = req.method();

  // SSE 哑信号通道：返回空 event-stream（本机无 backend，仅为消噪）。
  if (p.includes("/stream") || p.includes("/events")) {
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: "",
    });
  }
  if (method !== "GET") {
    unmatched.push(`${method} ${p}`);
    return route.fulfill(json({ ok: true }));
  }
  if (p === "/api/auth/me" || p === "/api/auth/profile") {
    return route.fulfill(json(ME));
  }
  if (p === "/api/workspaces/my-bindings") return route.fulfill(json([]));
  if (p === "/api/workspaces") {
    return route.fulfill(json({ items: [WORKSPACE], total: 1 }));
  }
  // git-log status（workspace 详情页/会话 workspace scope 顶部紧凑态数据源）：
  // 必须放在 /api/workspaces/ 兜底之前，否则被工作区详情固件吞掉。
  if (/^\/api\/workspaces\/[^/]+\/git-log\/status$/.test(p)) {
    return route.fulfill(
      json({
        git_mode: "git",
        branch: "main",
        detached: false,
        upstream: "origin/main",
        ahead: 2,
        behind: 0,
        dirty: {
          files_changed: 2,
          additions: 3,
          deletions: 1,
          untracked_count: 2,
        },
        head_short: "13c7d29c",
        empty: false,
        fetch: { performed: true, error: null },
        synced_at: iso(6),
      }),
    );
  }
  if (p.startsWith("/api/workspaces/")) {
    // 工作区详情 / 归档守卫等：单工作区固件。
    return route.fulfill(json(WORKSPACE));
  }
  if (p === "/api/daemon/machines") {
    return route.fulfill(
      json({ items: [MACHINE], total: 1, shared_to_me: [], shared_to_me_total: 0 }),
    );
  }
  if (p === "/api/daemon/sessions") {
    return route.fulfill(json({ items: SESSIONS, total: SESSIONS.length }));
  }
  if (p.startsWith("/api/daemon/sessions/")) {
    return route.fulfill(json(SESSIONS[0]));
  }
  if (p === "/api/daemon/group-chats") return route.fulfill(json([]));
  if (p.startsWith("/api/daemon/group-chats/")) return route.fulfill(json({}));
  if (p === "/api/llm-providers") return route.fulfill(json({ items: [] }));
  if (p === "/api/daemon/instances") return route.fulfill(json([]));
  if (p.startsWith("/api/daemon/runtimes")) return route.fulfill(json([]));
  if (p.startsWith("/api/git-log")) {
    return route.fulfill(json({ available: false }));
  }
  unmatched.push(`${method} ${p}`);
  return route.fulfill(json({ items: [], total: 0 }));
});

const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
});

await page.goto(`http://localhost:3000${routePath}`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
// 就绪条件：分栏容器（改后）或空门户态（改前的基线版本无分栏 testid）——两者
// 任一出现即门户主体已渲染。
await page.waitForSelector(
  '[data-testid="sessions-portal-panes"], [aria-label="门户空态"]',
  { timeout: 60_000 },
);
// 列表/树数据 settle（react-query 首拉 + 渲染）。
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
await browser.close();

console.log(`[ok] 截图: ${out}`);
console.log(`[route] ${routePath}`);
const titleVisible = await Promise.resolve(null);
if (unmatched.length > 0) {
  console.log("[未命中 route（走兜底空响应）]");
  for (const u of [...new Set(unmatched)]) console.log("  - " + u);
}
if (consoleErrors.length > 0) {
  console.log("[控制台错误（去重前 10 条）]");
  for (const e of [...new Set(consoleErrors)].slice(0, 10)) console.log("  - " + e);
}
void titleVisible;
