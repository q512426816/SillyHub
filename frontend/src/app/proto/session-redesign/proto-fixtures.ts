"use client";

/**
 * dev-only 预览数据面（fetch 打桩 + Query 缓存预热）—— 2026-10-20-session-page-
 * dsh-alignment / D-010（dev 预览路由直接渲染真实组件）/ D-017（定稿原型必须由
 * 真实组件产出）。
 *
 * 为什么在 fetch 层打桩（而不是给组件传假 props）：
 *   - 本页要复用的真实组件（AppShell / SessionListPanel / CtxUsageBar…）各自
 *     经 react-query 自行取数，props 面里没有数据入口，**也不允许**为了预览去
 *     改它们的必填 props 或行为。
 *   - 故在本路由内接管 `window.fetch`，按路径回小份确定性 JSON（形状照真实 DTO，
 *     见 frontend/src/lib/api-types.ts 与各 lib 的响应类型），其余请求原样透传。
 *
 * 三重边界（都必要）：
 *   1. 只在浏览器里装（SSR 无 fetch 打桩需求，服务端数据靠 query 预热）；
 *   2. 只在 `/proto/*` 路由下生效（离开预览页后同一 tab 的其它页面请求原样透传，
 *      不会误吃假数据）；
 *   3. 未打桩的 `/api/*` 一律 404 + 结构化错误体——**绝不返回 401**：
 *      frontend/src/lib/api.ts 的 401 分支会 clear() 登录态并跳 /login，预览页
 *      不能有这条副作用。
 *
 * 与生产的关系：本文件只被 frontend/src/app/proto/** import；生产路由不引用，
 * 不进导航，不改任何生产组件的默认行为。
 */
import { QueryClient } from "@tanstack/react-query";

import type {
  AgentSessionListResponse,
  AgentSessionRead,
  DaemonMachineRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";
import type { AgentLogListResponse } from "@/lib/agent-logs";
import type { MemberBindingView } from "@/lib/workspace-binding";
import type { Workspace, WorkspaceListResponse } from "@/lib/workspaces";
import type { CurrentWorkspace } from "@/stores/workspace";
import type { SessionUser } from "@/stores/session";
import { daemonMachinesQueryKey } from "@/lib/use-daemon-machines";
import { AGENT_SESSIONS_TREE_FETCH_LIMIT } from "@/lib/daemon";

/** 预览页路由前缀（fetch 打桩的作用域判据）。 */
const PROTO_ROUTE_PREFIX = "/proto/";

/** 真实会话导出里的会话 id（与 .proto-staging/session-export.json 的 session.id 同源）。 */
export const PREVIEW_SESSION_ID = "400ca9d3-5352-42e5-8c2d-fa5814f6f90e";

/** 真实会话标题（导出 session.title；导出缺席时页面头部的兜底文案）。 */
export const PREVIEW_SESSION_TITLE = "消防设施台账4轮";

/** 预览「当前工作区」：真实会话所属工作区（打桩值，非真实 uuid 语义依赖）。 */
export const PREVIEW_WORKSPACE: CurrentWorkspace = {
  id: "0f6c1a52-7a1e-45c9-9c4e-2b0f3f5a1d01",
  name: "智能体平台 · 演示工作区",
  daemon_id: "3c1b7d20-58e9-4d0a-9f3b-6a2d4c8e9b11",
  daemon_online: true,
  root_path: "/home/preview/multi-agent-platform",
};

/**
 * 预览用户（fixture 菜单/权限数据）：平台管理员 → registry 里全部菜单可见
 * （frontend/src/lib/permission.ts hasAnyPermission 短路），足以把
 * workspace / agent / config / governance / system 五组真实菜单渲染出来。
 */
export const PREVIEW_USER: SessionUser = {
  id: "5a0e2c11-2222-4c33-8d44-55aa66bb77cc",
  email: "preview@sillyhub.local",
  displayName: "预览用户",
  is_platform_admin: true,
  permissions: [],
  avatar: null,
};

/* ─────────────────────────── fixture DTO（形状照真实响应） ─────────────────────────── */

const NOW_ISO = "2026-10-20T13:02:41.282805+00:00";

const WORKSPACE_PREVIEW: Workspace = {
  id: PREVIEW_WORKSPACE.id,
  name: "智能体平台 · 演示工作区",
  display_alias: "智能体平台",
  slug: "multi-agent-platform",
  root_path: PREVIEW_WORKSPACE.root_path ?? "/home/preview/multi-agent-platform",
  status: "active",
  component_key: "sillyhub",
  type: "product",
  role: "owner",
  description: "预览路由用的工作区（打桩）",
  repo_url: null,
  default_branch: "main",
  default_agent: "claude",
  default_model: null,
  tech_stack: ["typescript", "python"],
  build_command: "pnpm build",
  test_command: "pnpm test",
  source_yaml_path: null,
  created_by: PREVIEW_USER.id,
  created_at: "2026-09-01T02:00:00Z",
  updated_at: "2026-10-20T12:00:00Z",
  last_scanned_at: "2026-10-20T12:00:00Z",
  deleted_at: null,
};

const WORKSPACE_FIRE: Workspace = {
  ...WORKSPACE_PREVIEW,
  id: "8b7d4e33-1111-4a22-9f00-aa11bb22cc33",
  name: "消防设施器材 · fire/unitLedger",
  display_alias: "消防设施器材",
  slug: "fire-unit-ledger",
  root_path: "/home/preview/fire-unitLedger",
  status: "active",
  role: "member",
  type: "product",
};

const WORKSPACE_DESIGN: Workspace = {
  ...WORKSPACE_PREVIEW,
  id: "c4d5e6f7-8888-4b99-8777-1234567890ab",
  name: "设计系统 · tokens",
  display_alias: null,
  slug: "design-tokens",
  root_path: "/home/preview/design-tokens",
  status: "active",
  role: "member",
  type: "component",
};

const PROTO_WORKSPACES: Workspace[] = [
  WORKSPACE_PREVIEW,
  WORKSPACE_FIRE,
  WORKSPACE_DESIGN,
];

const PROTO_BINDINGS: MemberBindingView[] = [
  {
    workspace_id: PREVIEW_WORKSPACE.id,
    user_id: PREVIEW_USER.id,
    daemon_id: PREVIEW_WORKSPACE.daemon_id,
    runtime_id: "82722a5c-cb4e-4d17-8b12-818aa72d5542",
    root_path: PREVIEW_WORKSPACE.root_path ?? "/home/preview/multi-agent-platform",
    path_source: "manual",
    shared: false,
    synced_at: NOW_ISO,
    last_scan_at: NOW_ISO,
    init_synced_at: NOW_ISO,
    init_synced_spec_version: 3,
  },
];

const RUNTIME_CLAUDE: DaemonRuntimeRead = {
  id: "82722a5c-cb4e-4d17-8b12-818aa72d5542",
  daemon_instance_id: PREVIEW_WORKSPACE.daemon_id,
  display_alias: null,
  name: "claude-code",
  provider: "claude",
  version: "2.1.0",
  daemon_version: "0.9.14",
  os: "linux",
  arch: "x64",
  status: "online",
  last_heartbeat_at: NOW_ISO,
  capabilities: null,
  allowed_roots: [],
  created_at: "2026-09-01T02:00:00Z",
  updated_at: NOW_ISO,
};

const RUNTIME_DSH: DaemonRuntimeRead = {
  ...RUNTIME_CLAUDE,
  id: "1b2c3d4e-5f60-4718-29ab-cdef01234567",
  name: "dsh-acp",
  provider: "dsh",
  version: "0.4.2",
};

const PROTO_MACHINES: DaemonMachineRead[] = [
  {
    id: PREVIEW_WORKSPACE.daemon_id ?? "3c1b7d20-58e9-4d0a-9f3b-6a2d4c8e9b11",
    hostname: "sevishes",
    display_alias: "sevishes · 主控",
    os: "linux",
    arch: "x64",
    status: "online",
    last_heartbeat_at: NOW_ISO,
    version: "0.9.14",
    build_id: "a1b2c3d",
    started_at: "2026-10-19T22:10:00Z",
    created_at: "2026-09-01T02:00:00Z",
    runtime_count: 2,
    online_runtime_count: 2,
    runtimes: [RUNTIME_CLAUDE, RUNTIME_DSH],
  },
  {
    id: "9d8c7b6a-5432-4109-8fed-cba987654321",
    hostname: "DESKTOP-HJ0AM09",
    display_alias: "DESKTOP-HJ0AM09",
    os: "windows",
    arch: "x64",
    status: "online",
    last_heartbeat_at: NOW_ISO,
    version: "0.9.12",
    build_id: "f0e1d2c",
    started_at: "2026-10-20T00:30:00Z",
    created_at: "2026-09-10T02:00:00Z",
    runtime_count: 1,
    online_runtime_count: 1,
    runtimes: [
      {
        ...RUNTIME_CLAUDE,
        id: "aabbccdd-eeff-4011-2233-445566778899",
        daemon_instance_id: "9d8c7b6a-5432-4109-8fed-cba987654321",
        os: "windows",
        name: "claude-code",
      },
    ],
  },
];

/** 单条会话 fixture 的默认项（把必填 DTO 字段收在一处）。 */
const SESSION_BASE: Omit<AgentSessionRead, "id" | "title" | "workspace_id"> = {
  runtime_id: RUNTIME_CLAUDE.id,
  lease_id: null,
  provider: "claude",
  status: "active",
  agent_session_id: "5f0e1d2c-3b4a-4596-8877-665544332211",
  config: null,
  turn_count: 21,
  created_at: "2026-10-20T03:25:28Z",
  last_active_at: "2026-10-20T13:02:41Z",
  ended_at: null,
  change_id: null,
  user_id: PREVIEW_USER.id,
  session_kind: "interactive",
  deleted_at: null,
  archived_at: null,
  pinned_at: null,
  current_run_id: null,
  current_run_status: null,
  terminating_at: null,
  agent_profile_id: null,
  llm_provider_id: null,
  ctx_window_tokens: null,
  owner_name: "预览用户",
  origin: "chat",
  parent_session_id: null,
  tree_depth: 0,
  fork_of_session_id: null,
  fork_at_run_id: null,
  engine_fork_anchor: null,
  config_snapshot: {
    profile_name: "取消编译代码",
    provider_name: null,
    model: "glm-5.3[1m]",
    engine: "claude",
    machine_name: "sevishes",
    agent_name: "centos8",
  },
};

/** 左侧会话列 fixture（工作区树形态：3 个工作区 + 非工作区桶）。 */
const PROTO_SESSIONS: AgentSessionRead[] = [
  {
    ...SESSION_BASE,
    id: PREVIEW_SESSION_ID,
    title: PREVIEW_SESSION_TITLE,
    workspace_id: PREVIEW_WORKSPACE.id,
    pinned_at: "2026-10-20T13:03:00Z",
  },
  {
    ...SESSION_BASE,
    id: "e1f2a3b4-c5d6-4e7f-8091-a2b3c4d5e6f7",
    title: "会话页视觉重做：v3 字号阶与轮间节奏",
    workspace_id: PREVIEW_WORKSPACE.id,
    status: "ended",
    ended_at: "2026-10-20T09:12:00Z",
    last_active_at: "2026-10-20T09:12:00Z",
    turn_count: 8,
    config_snapshot: {
      profile_name: "代码评审",
      provider_name: "智谱 GLM",
      model: "glm-4.6",
      engine: "codex",
      machine_name: "DESKTOP-HJ0AM09",
      agent_name: "主控",
    },
  },
  {
    ...SESSION_BASE,
    id: "0a1b2c3d-4e5f-4670-8899-aabbccddeeff",
    title: "导入模板补框线：Excel 边框样式调整",
    workspace_id: WORKSPACE_FIRE.id,
    status: "reconnecting",
    last_active_at: "2026-10-20T12:40:00Z",
    turn_count: 4,
  },
  {
    ...SESSION_BASE,
    id: "f0e1d2c3-b4a5-4968-8776-5544332211ff",
    title: "单位级台账页筛选条件回填",
    workspace_id: WORKSPACE_FIRE.id,
    status: "failed",
    ended_at: "2026-10-19T18:20:00Z",
    last_active_at: "2026-10-19T18:20:00Z",
    turn_count: 12,
    current_run_status: "failed",
  },
  {
    ...SESSION_BASE,
    id: "11223344-5566-4778-99aa-bbccddeeff00",
    title: "三主题 token 对照：ai-native / blue / dark",
    workspace_id: WORKSPACE_DESIGN.id,
    status: "ended",
    ended_at: "2026-10-18T07:05:00Z",
    last_active_at: "2026-10-18T07:05:00Z",
    turn_count: 16,
    provider: "dsh",
    runtime_id: RUNTIME_DSH.id,
  },
  {
    ...SESSION_BASE,
    id: "99887766-5544-4332-2211-00ffeeddccbb",
    title: "临时排查：会话页滚动抖动",
    workspace_id: null,
    status: "ended",
    ended_at: "2026-10-17T11:00:00Z",
    last_active_at: "2026-10-17T11:00:00Z",
    turn_count: 2,
    origin: "tool_report",
  },
];

const PROTO_SESSION_LIST: AgentSessionListResponse = {
  items: PROTO_SESSIONS,
  total: PROTO_SESSIONS.length,
  limit: AGENT_SESSIONS_TREE_FETCH_LIMIT,
  offset: 0,
};

const PROTO_WORKSPACE_LIST: WorkspaceListResponse = {
  items: PROTO_WORKSPACES,
  total: PROTO_WORKSPACES.length,
};

const PROTO_INSTANCES = [
  {
    id: PREVIEW_WORKSPACE.daemon_id ?? "",
    hostname: "sevishes",
    display_alias: "sevishes · 主控",
    status: "online",
    version: "0.9.14",
    build_id: "a1b2c3d",
    providers: [
      { provider: "claude", status: "online", version: "2.1.0" },
      { provider: "dsh", status: "online", version: "0.4.2" },
    ],
  },
];

const PROTO_AGENT_LOGS: AgentLogListResponse = { items: [] };

/** 未打桩 `/api/*` 的统一响应（404 而非 401——见文件头边界 3）。 */
const NOT_STUBBED_BODY = {
  code: "proto_not_stubbed",
  message: "dev 预览路由：该接口未打桩",
  request_id: null,
  details: null,
};

/* ─────────────────────────────── fetch 打桩 ─────────────────────────────── */

/** 一条打桩结果（status 缺省 200）。 */
interface ProtoStub {
  status?: number;
  body: unknown;
}

/** 精确路径 → 打桩响应（query 串不参与匹配）。 */
function resolveStub(pathname: string): ProtoStub {
  switch (pathname) {
    case "/api/daemon/sessions":
      return { body: PROTO_SESSION_LIST };
    case "/api/daemon/machines":
      return {
        body: {
          items: PROTO_MACHINES,
          total: PROTO_MACHINES.length,
          limit: 100,
          offset: 0,
          shared_to_me: [],
        },
      };
    case "/api/daemon/instances":
      return { body: PROTO_INSTANCES };
    case "/api/workspaces":
      return { body: PROTO_WORKSPACE_LIST };
    case "/api/workspaces/my-bindings":
      return { body: PROTO_BINDINGS };
    case "/api/agent-logs":
      return { body: PROTO_AGENT_LOGS };
    case "/api/menu-overrides":
      return { body: { items: [] } };
    case "/api/llm-providers":
      // 无供应商 → CtxUsageBar 的额度胶囊静默不渲染（弱依赖降级，组件自身分支）。
      return { body: { items: [], total: 0 } };
    case "/api/notifications":
      return { body: { items: [], total: 0 } };
    case "/api/notifications/unread-count":
      return { body: { count: 0 } };
    // 通知 SSE：404 = 永久性失败（lib/fetch-sse 的 PERMANENT_SSE_ERROR_STATUSES），
    // 不重连、不打日志风暴。
    case "/api/notifications/events":
      return { status: 404, body: NOT_STUBBED_BODY };
    default:
      return { status: 404, body: NOT_STUBBED_BODY };
  }
}

/** 取请求 URL（fetch(input) 三种入参形态）。 */
function toUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonResponse(stub: ProtoStub): Response {
  return new Response(JSON.stringify(stub.body), {
    status: stub.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

let protoFetchInstalled = false;

/**
 * 接管 window.fetch：`/proto/*` 路由下的 `/api/*` 走打桩，其余原样透传。
 * 幂等（模块 HMR 重复调用安全）。
 */
export function installProtoFetchMock(): void {
  if (typeof window === "undefined") return;
  if (protoFetchInstalled) return;
  protoFetchInstalled = true;

  const originalFetch: typeof window.fetch = window.fetch.bind(window);

  const protoFetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = toUrlString(input);
    const inProtoRoute = window.location.pathname.startsWith(PROTO_ROUTE_PREFIX);
    if (!inProtoRoute || !url.includes("/api/")) {
      return originalFetch(input, init);
    }
    let pathname: string;
    try {
      pathname = new URL(url, window.location.origin).pathname;
    } catch {
      return originalFetch(input, init);
    }
    return Promise.resolve(jsonResponse(resolveStub(pathname)));
  };

  window.fetch = protoFetch as typeof window.fetch;
}

/* ─────────────────────────── Query 缓存预热（SSR 同源数据） ─────────────────────────── */

/**
 * 预览专用 QueryClient：重试关闭（打桩数据失败没有重试意义）、
 * staleTime=Infinity（预热数据永不因「过期」触发真实请求）、关窗聚焦不重拉。
 */
export function createProtoQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

/**
 * 预热各组件「首帧就要读」的查询缓存。
 *
 * 为什么需要：SSR 阶段没有 fetch 打桩（也不该有网络），组件首帧拿不到数据就会
 * 渲染「加载中」——静态快照里左栏与顶栏仍是空的。把这些查询的 key 按组件源码
 * 逐字预热后，SSR 与 hydrate 首帧直接命中同一份 fixture（两端一致，不产生
 * hydration mismatch）。
 *
 * key 口径（与组件源码逐一对应，改组件 key 必须同步本函数）：
 *   - ["workspace-switcher-list"]：session-list-panel.tsx + workspace-switcher.tsx
 *   - ["agentSessions","sessionsPortal",scope,{limit,archived,assoc}]：session-list-panel.tsx
 *   - daemonMachinesQueryKey({limit:100}, false)：session-list-panel.tsx / use-daemon-status-map
 *   - ["menuOverrides"]：lib/menu-overrides.ts（app-shell 导航覆盖层）
 */
export function seedProtoQueries(client: QueryClient): void {
  client.setQueryData(["workspace-switcher-list"], {
    items: PROTO_WORKSPACES,
    bindings: PROTO_BINDINGS,
  });
  client.setQueryData(
    [
      "agentSessions",
      "sessionsPortal",
      null,
      {
        limit: AGENT_SESSIONS_TREE_FETCH_LIMIT,
        archived: false,
        assoc: null,
      },
    ],
    PROTO_SESSION_LIST,
  );
  client.setQueryData(daemonMachinesQueryKey({ limit: 100 }, false), {
    items: PROTO_MACHINES,
    total: PROTO_MACHINES.length,
    sessions: [],
    sharedToMe: [],
  });
  client.setQueryData(["menuOverrides"], []);
}
