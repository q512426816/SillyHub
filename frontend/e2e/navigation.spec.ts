/**
 * 导航权限冒烟（task-04）。
 *
 * 设计依据：
 * - design.md §4.2 用例表 N1–N4
 * - design.md §3.2 权限可见集：挂 workspace:read 角色的普通用户可见
 *   「工作区首页 / 智能体档案 / 智能体会话 / 技能管理」四菜单
 *   （后三者 permissions:[] = 登录即可见，menu-permissions.ts:184/214/228）。
 *
 * 菜单定位事实（frontend/src/components/app-shell.tsx:300）：
 * 侧边栏菜单渲染为 <Link>，可见文本 = menu-permissions.ts 的 menuLabel 中文值
 * （工作区首页 / 智能体档案 / 智能体会话 / 技能管理 / API 密钥 / Git 身份管理…），
 * 故用 getByRole("link", { name: "<menuLabel>" }) 语义定位。
 *
 * 等待策略：全程不使用 networkidle（会话 SSE 挂起永不空闲），统一
 * domcontentloaded + waitForPageText 轮询正文文本。
 */

import { expect, test, type Page } from "@playwright/test";
import { createE2EContext, loginAsE2e, waitForPageText, type E2EContext } from "./helpers";

// workers:1 串行下共享 ctx（createE2EContext 建角色/用户开销大，全程复用）。
let ctx: E2EContext;

test.beforeAll(async () => {
  ctx = await createE2EContext();
});

test.beforeEach(async ({ page }: { page: Page }) => {
  await loginAsE2e(page, ctx);
});

// N1：/workspaces 首页渲染（设计依据 design.md §4.2 N1）
// 挂 workspace:read 用户 GET /api/workspaces 200；页面结构见
// (dashboard)/workspaces/page.tsx:224 PageHeader title="选择工作区"。
test("N1 登录后 /workspaces 渲染选择工作区页", async ({ page }) => {
  await expect(page).toHaveURL(/\/workspaces\/?$/);
  await waitForPageText(page, "选择工作区");
});

// N2：侧边栏点击「智能体会话」→ /sessions（设计依据 design.md §4.2 N2）
// 关键元素：sessions-portal.tsx:345 portalTitle（全局 scope 无后缀）="智能体会话"，
// SessionListPanel 头部 h2 "会话"（session-list-panel.tsx:1145）。
test("N2 侧边栏点击智能体会话进入 /sessions", async ({ page }) => {
  const link = page.getByRole("link", { name: "智能体会话" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/sessions/);
  await waitForPageText(page, "智能体会话");
  await expect(page.getByRole("heading", { name: "会话", exact: true })).toBeVisible();
});

// N3：侧边栏「智能体档案」→ /agent-profiles；「技能管理」→ /settings/skills
// （设计依据 design.md §4.2 N3；技能管理实路径 /settings/skills，
// menu-permissions.ts:186 href="/settings/skills"）
// 页面关键元素：agent-profiles/page.tsx:123 PageHeader title="智能体档案"；
// settings/skills/page.tsx:126 PageHeader title="技能管理"。
test("N3 侧边栏进入智能体档案与技能管理", async ({ page }) => {
  const profiles = page.getByRole("link", { name: "智能体档案" });
  await expect(profiles).toBeVisible();
  await profiles.click();
  await expect(page).toHaveURL(/\/agent-profiles/);
  await waitForPageText(page, "智能体档案");

  const skills = page.getByRole("link", { name: "技能管理" });
  await expect(skills).toBeVisible();
  await skills.click();
  await expect(page).toHaveURL(/\/settings\/skills/);
  await waitForPageText(page, "技能管理");
});

// N4 负向：需独立 admin 权限的菜单对 workspace:read 用户不可见
// （设计依据 design.md §4.2 N4；不给用户加任何 admin 权限）
// - API 密钥：require api_key:admin（menu-permissions.ts:256）
// - Git 身份管理：require git_identity:admin（menu-permissions.ts:268）
// - 设置 / MCP 管理：require settings:admin（menu-permissions.ts:202/373）
test("N4 无 admin 权限的用户侧边栏不渲染管理菜单", async ({ page }) => {
  await waitForPageText(page, "选择工作区");
  for (const label of ["API 密钥", "Git 身份管理", "设置", "MCP 管理"]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }
});
