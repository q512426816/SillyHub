/**
 * TestApiClient —— E2E 测试数据搭建用的轻量 API 客户端（task-02，设计依据
 * design.md §3.2 身份策略：bootstrap 管理员 → 幂等建角色 → 建 run-id 冒烟用户）。
 *
 * 仅用原生 fetch 直连后端，零 src/ import（零构建耦合，multica 同款）。
 * API 契约依据后端源码核实：
 * - POST /api/auth/login：backend/app/modules/auth/schema.py LoginRequest {account, password, captcha_token?}
 *   → TokenPair {access_token, refresh_token, token_type, access_expires_in, refresh_expires_in}
 * - GET /api/auth/me：→ MeResponse {user: UserRead, workspaces: [...], permissions: string[]（顶层）}
 * - GET /api/admin/roles：Query {search?, is_active?, page=1, size=20(≤100)}
 *   → RoleListResponse {items: RoleRead[], total, page, size}；RoleRead 含 id/key/name/...
 * - POST /api/admin/roles：RoleCreateRequest（extra=forbid）
 *   {key: ^[a-z][a-z0-9_]*$ ≤50, name ≤100, description?, permission_keys: string[], is_active=true}
 * - POST /api/admin/users：UserCreateRequest（extra=forbid）
 *   {email?, password?(≥8 且过强度校验), username(≥3), display_name?, is_platform_admin=false,
 *    login_enabled=true, organization_ids=[], role_ids=[]}
 */

import { E2E_API_URL, E2E_BOOTSTRAP_EMAIL, E2E_BOOTSTRAP_PASSWORD } from "./env";

/** backend/app/modules/auth/schema.py TokenPair */
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  access_expires_in: number;
  refresh_expires_in: number;
}

/** backend/app/modules/auth/schema.py UserRead（/api/auth/me 内嵌） */
export interface MeUser {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  employee_no: string | null;
  status: string;
  is_platform_admin: boolean;
  last_login_at: string | null;
  created_at: string;
}

/** backend/app/modules/auth/schema.py MeResponse */
export interface MeResponse {
  user: MeUser;
  workspaces: Array<{
    workspace_id: string;
    role_key: string;
    role_name: string;
  }>;
  /** 注意：permissions 在响应顶层，不在 user 里 */
  permissions: string[];
}

/** backend/app/modules/admin/schema.py RoleRead（列表/创建响应） */
export interface RoleRead {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
  user_count: number;
  created_at: string;
  updated_at: string;
}

/** backend/app/modules/admin/schema.py UserRead（创建用户响应） */
export interface AdminUserRead {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  status: string;
  is_platform_admin: boolean;
  login_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  organizations: unknown[];
  roles: Array<{ id: string; key: string; name: string }>;
  initial_password: string | null;
}

export class TestApiClient {
  private readonly baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string = E2E_API_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** 用 bootstrap 管理员凭据登录并保存 Bearer token（后续 authedFetch 复用）。 */
  async loginAsAdmin(): Promise<TokenPair> {
    const pair = await this.login(E2E_BOOTSTRAP_EMAIL, E2E_BOOTSTRAP_PASSWORD);
    this.token = pair.access_token;
    return pair;
  }

  /**
   * 幂等确保冒烟角色存在：先 GET /api/admin/roles 分页查 key，
   * 已存在则复用，否则 POST 创建（key 满足 ^[a-z][a-z0-9_]*$，runId 中的
   * "-" 不合法，需替换为 "_"）。
   */
  async ensureSmokeRole(runId: string): Promise<RoleRead> {
    const key = `e2e_smoke_${runId.replace(/-/g, "_")}`;
    // size 上限 100（backend admin/router.py list_roles Query le=100）
    const list = await this.authedFetch<RoleList>(
      `/api/admin/roles?search=${encodeURIComponent(key)}&size=100`,
    );
    const existing = list.items.find((role) => role.key === key);
    if (existing) return existing;
    return this.authedFetch<RoleRead>("/api/admin/roles", {
      method: "POST",
      json: {
        key,
        name: `E2E Smoke ${runId}`,
        permission_keys: ["workspace:read"],
      },
    });
  }

  /** 创建挂指定角色的冒烟用户（username ≥3、password ≥8 且含字母数字）。
   *  username 可显式传入（helpers 按含 context 序号的规则生成，保证唯一）。 */
  async createSmokeUser(
    runId: string,
    roleId: string,
    username?: string,
    email?: string,
  ): Promise<AdminUserRead> {
    return this.authedFetch<AdminUserRead>("/api/admin/users", {
      method: "POST",
      json: {
        email: email ?? `e2e-${runId}@test.local`,
        username: username ?? `e2e${runId.replace(/-/g, "")}`,
        password: `E2eSmoke${runId}1a`,
        role_ids: [roleId],
        is_platform_admin: false,
        login_enabled: true,
      },
    });
  }

  /** 登录任意账号，返回 TokenPair（不修改实例持有的 admin token）。 */
  async login(account: string, password: string): Promise<TokenPair> {
    return this.request<TokenPair>("/api/auth/login", {
      method: "POST",
      json: { account, password },
    });
  }

  /** GET /api/auth/me —— permissions 在响应顶层。 */
  async fetchMe(token: string): Promise<MeResponse> {
    const res = await fetch(`${this.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await assertOk(res, "GET /api/auth/me");
    return (await res.json()) as MeResponse;
  }

  /** 带认证的请求；非 2xx 抛出带 HTTP status + body 摘要的中文错误。 */
  private async authedFetch<T>(
    path: string,
    init: { method?: string; json?: unknown } = {},
  ): Promise<T> {
    if (!this.token) {
      throw new Error("尚未登录管理员：请先调用 loginAsAdmin()");
    }
    return this.request<T>(path, init, this.token);
  }

  private async request<T>(
    path: string,
    init: { method?: string; json?: unknown },
    token?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    await assertOk(res, `${init.method ?? "GET"} ${path}`);
    return (await res.json()) as T;
  }
}

interface RoleList {
  items: RoleRead[];
  total: number;
  page: number;
  size: number;
}

async function assertOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(
    `请求失败：${what}，HTTP ${res.status} ${res.statusText}，响应体：${body.slice(0, 500)}`,
  );
}
