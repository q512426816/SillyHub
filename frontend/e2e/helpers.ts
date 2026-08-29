/**
 * E2E 通用助手（task-02，设计依据 design.md §3.3 登录注入 D-003@v1、
 * §3.2 身份策略 D-002@v2）。
 *
 * injectSession 的 localStorage 落盘形状必须与
 * frontend/src/stores/session.ts 的 zustand persist（key
 * "multi-agent-platform.session"，version 1，partialize 只保留
 * hydrated/user/accessToken/refreshToken）严格一致；user 字段映射复刻
 * frontend/src/lib/auth.ts fetchMe 的降级合并（displayName 逐级降级、
 * permissions 取 MeResponse 顶层）。注入格式集中在本文件单点（R5）。
 */

import type { Page } from "@playwright/test";
import {
  TestApiClient,
  type AdminUserRead,
  type MeResponse,
  type RoleRead,
  type TokenPair,
} from "./fixtures";

/** 每次测试进程唯一的 run id（multica 同款）。 */
export const E2E_RUN_ID = Date.now().toString(36) + "-" + process.pid.toString(36);

/** 同进程内 context 自增序号：多个 spec 共享本模块时（workers:1 同 worker），
 *  runId 相同会导致 createSmokeUser 用户名 409 冲突，序号保证每个 context 唯一。 */
let ctxSeq = 0;

export interface E2EContext {
  api: TestApiClient;
  role: RoleRead;
  user: AdminUserRead;
  email: string;
  /** 登录名：后端 D-001 纯 username 登录（account 不识别 @ email），表单/API 登录都用它 */
  username: string;
  password: string;
  tokenPair: TokenPair;
  me: MeResponse;
}

/**
 * 一站式搭建冒烟身份：admin 登录 → 幂等建角色 → 建用户 → 用户登录 → fetchMe。
 * 后续 spec 通过 loginAsE2e(page, ctx) 把该身份注入浏览器。
 */
export async function createE2EContext(): Promise<E2EContext> {
  const api = new TestApiClient();
  await api.loginAsAdmin();
  const role = await api.ensureSmokeRole(E2E_RUN_ID);
  // email/username 都带 context 序号：workers:1 下多 spec 可能共享本模块（runId 相同），
  // 不带序号会撞 users 表的 email/username 唯一约束（ux_users_email_active）。
  const seq = ++ctxSeq;
  const email = `e2e-${E2E_RUN_ID}-${seq}@test.local`;
  const username = `e2e${E2E_RUN_ID.replace(/-/g, "")}${seq}`;
  const user = await api.createSmokeUser(E2E_RUN_ID, role.id, username, email);
  const password = `E2eSmoke${E2E_RUN_ID}1a`;
  // D-001：后端登录 account 只按 username 查，不识别 email——必须用 username 登录
  const tokenPair = await api.login(username, password);
  const me = await api.fetchMe(tokenPair.access_token);
  return { api, role, user, email, username, password, tokenPair, me };
}

/** session.ts 落盘的 SessionUser 形状（auth.ts fetchMe 映射后的驼峰形状）。 */
interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  is_platform_admin: boolean;
  permissions: string[];
}

/**
 * 把已登录会话注入 page 的 localStorage（zustand persist v1 信封），
 * 使前端在下次导航时直接恢复登录态，跳过登录页。
 */
export function injectSession(page: Page, ctx: E2EContext): void {
  // 映射与 frontend/src/lib/auth.ts fetchMe 完全一致：
  // email 降级合并 username；displayName 逐级降级；permissions 取顶层。
  const sessionUser: SessionUser = {
    id: ctx.me.user.id,
    email: ctx.me.user.email ?? ctx.me.user.username ?? "",
    displayName:
      ctx.me.user.display_name ?? ctx.me.user.email ?? ctx.me.user.username ?? "",
    is_platform_admin: ctx.me.user.is_platform_admin,
    permissions: ctx.me.permissions ?? [],
  };
  void page.addInitScript((payload: { key: string; value: string }) => {
    window.localStorage.setItem(payload.key, payload.value);
  }, {
    key: "multi-agent-platform.session",
    value: JSON.stringify({
      state: {
        hydrated: true,
        user: sessionUser,
        accessToken: ctx.tokenPair.access_token,
        refreshToken: ctx.tokenPair.refresh_token,
      },
      version: 1,
    }),
  });
}

/** 注入会话后跳转到工作区页，视为"已登录进入应用"。 */
export async function loginAsE2e(page: Page, ctx: E2EContext): Promise<void> {
  injectSession(page, ctx);
  await page.goto("/workspaces", { waitUntil: "domcontentloaded" });
}

/** 轮询等待页面正文包含指定文本（默认 30s，适配 dev server 首次编译）。 */
export function waitForPageText(
  page: Page,
  text: string,
  timeout = 30_000,
): Promise<void> {
  return page.waitForFunction(
    (needle: string) =>
      (document.body?.innerText ?? "").includes(needle),
    text,
    { timeout },
  ).then(() => undefined);
}
