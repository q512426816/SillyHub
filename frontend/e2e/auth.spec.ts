/**
 * 认证链路 E2E（task-03，设计依据 design.md §4.1 用例表 + §3.3 登录链路事实）。
 *
 * 覆盖 A1-A4：
 * - A1 未登录访问 /workspaces → 客户端守卫重定向 /login
 * - A2 表单登录成功 → 进入 /workspaces + localStorage 落盘 accessToken
 * - A3 错误密码 → 停留 /login + 错误提示可见（只提交一次，避免触发 423 captcha 阈值）
 * - A4 登出 → 回 /login + token 清空 + 守卫生效
 *
 * 身份策略：test.beforeAll 建一次共享 createE2EContext()（admin 登录 + 建角色 +
 * 建用户 + 用户登录各 1 次），每用例新开 page（workers:1 顺序执行，比每用例
 * beforeEach 建新用户省 3 次 admin 登录 + 3 次用户登录，且远低于限流阈值）。
 * 表单登录本身是被测行为，故不调用 injectSession/loginAsE2e 注入浏览器。
 *
 * 表单结构事实（frontend/src/app/(auth)/login/page.tsx 源码核实）：
 * - antd Form：登录名 name="account" placeholder="登录名"；密码 name="password"
 *   placeholder="请输入密码"（Input.Password）；提交按钮文本"登录"。
 * - 登录失败：setState error 渲染在 .text-red-600 提示块，401 文案含「用户名或密码」。
 * - 登出入口（frontend/src/components/top-bar.tsx）：aria-label="用户菜单" 按钮 →
 *   DropdownMenuItem「退出登录」→ 二次确认弹窗（logout-confirm-dialog.tsx）
 *   「确认退出登录？」→ 确认按钮「确认退出」。
 */

import { expect, test, type Page } from "@playwright/test";
import { createE2EContext, waitForPageText, type E2EContext } from "./helpers";

/** localStorage 中 session persist 的 key（stores/session.ts zustand persist）。 */
const SESSION_KEY = "multi-agent-platform.session";

/** 读取当前 page localStorage 里持久化的 accessToken（无则 null）。 */
async function readPersistedAccessToken(page: Page): Promise<string | null> {
  return page.evaluate((key: string) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        state?: { accessToken?: string | null };
      };
      return parsed.state?.accessToken ?? null;
    } catch {
      return null;
    }
  }, SESSION_KEY);
}

test.describe("认证链路（A1-A4）", () => {
  let ctx: E2EContext;

  test.beforeAll(async () => {
    // 共享身份：整套 spec 只建一次冒烟用户（admin 登录 ×1 + 用户登录 ×1，
    // 加上 A2/A3 表单内的登录共 3 次，远低于后端登录限流阈值）。
    ctx = await createE2EContext();
    // eslint-disable-next-line no-console
    console.log(
      `[auth.spec] 共享冒烟身份 username=${ctx.username}（beforeAll 建一次，4 用例复用；后端 D-001 登录名登录）`,
    );
  });

  test("A1 未登录访问 /workspaces 重定向到 /login", async ({ page }) => {
    // 显式清空 localStorage，保证从"未登录"状态出发（同 context 内 A2 落盘的
    // token 不会泄漏到本用例——顺序执行下 A1 先跑，这里仍防御性清一次）。
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.clear());

    await page.goto("/workspaces", { waitUntil: "domcontentloaded" });

    // 客户端守卫（(dashboard)/layout.tsx effect 中 replace("/login")）是异步的，
    // toHaveURL 自带轮询重试等待跳转完成。
    await expect(page).toHaveURL(/\/login/);
  });

  test("A2 表单登录成功进入 /workspaces 并持久化 accessToken", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    // 中文 UI 无 testid，按 placeholder 定位 antd 输入框（登录名 / 密码）。
    await page.getByPlaceholder("登录名").fill(ctx.username);
    await page.getByPlaceholder("请输入密码").fill(ctx.password);
    await page.getByRole("button", { name: /登\s*录/ }).click();

    // 登录成功 router.replace("/workspaces")（默认平台 sillyhub）。
    await expect(page).toHaveURL(/\/workspaces/);
    // 侧边栏/顶栏已渲染即视为进入应用（无工作区时列表是空态，不依赖列表容器；
    // 顶栏用户菜单按钮 aria-label="用户菜单"，top-bar.tsx 源码核实）。
    await expect(
      page.getByRole("button", { name: "用户菜单" }),
    ).toBeVisible();

    // zustand persist 落盘校验：session 信封 state.accessToken 非空。
    const accessToken = await readPersistedAccessToken(page);
    expect(accessToken, "localStorage session.state.accessToken 应非空").toBeTruthy();
  });

  test("A3 错误密码停留 /login 并显示错误提示", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("登录名").fill(ctx.username);
    await page.getByPlaceholder("请输入密码").fill("WrongPassword1a");
    // 只提交一次：连续失败 3 次会触发后端 423 人机验证，严禁多轮失败。
    await page.getByRole("button", { name: /登\s*录/ }).click();

    // 后端 401 文案含「用户名或密码」，login/page.tsx 渲染在红色提示块。
    await expect(page.getByText("用户名或密码")).toBeVisible();
    // 停留在登录页，未发生跳转。
    await expect(page).toHaveURL(/\/login/);
  });

  test("A4 登出后回到 /login 且守卫重新生效", async ({ page }) => {
    // 前置：先表单登录（登出是被测行为，登录只是搭状态；共享 ctx 已有有效凭据）。
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("登录名").fill(ctx.username);
    await page.getByPlaceholder("请输入密码").fill(ctx.password);
    await page.getByRole("button", { name: /登\s*录/ }).click();
    await expect(page).toHaveURL(/\/workspaces/);
    await expect(
      page.getByRole("button", { name: "用户菜单" }),
    ).toBeVisible();

    // 登出链路：顶栏用户菜单（top-bar.tsx）→「退出登录」→ 二次确认弹窗
    // （logout-confirm-dialog.tsx）→「确认退出」。
    await page.getByRole("button", { name: "用户菜单" }).click();
    await page.getByRole("menuitem", { name: "退出登录" }).click();
    await waitForPageText(page, "确认退出登录？");
    await page.getByRole("button", { name: "确认退出" }).click();

    await expect(page).toHaveURL(/\/login/);
    expect(
      await readPersistedAccessToken(page),
      "登出后 localStorage accessToken 应已清空",
    ).toBeNull();

    // 守卫重新生效：未登录再访问 /workspaces 仍被重定向回 /login。
    await page.goto("/workspaces", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/);
  });
});
