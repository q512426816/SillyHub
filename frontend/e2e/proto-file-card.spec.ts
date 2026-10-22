/**
 * dev 预览页验收：轮级「文件变更卡」形态原型（2026-10-20-session-page-dsh-alignment 线 C）——
 * `.sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-file-card-2026-10-21.png`。
 *
 * 只验形态与交互，不验数据链路（本是桩数据）：3 张卡在场、折叠态一行 28px、
 * 点头部展开成 24px 文件行、点行触发 onOpenFile（页面可见 state 兜底）、
 * 三个降级/归因标记各出现一次、控制台与页面异常为 0；另验 100 文件长列表限高内滚。
 *
 * 前置：本机 dev server 已在 :3000（配置不配 webServer，D-001@v1）。
 */

import path from "node:path";

import { expect, test } from "@playwright/test";

// 截图落变更目录（从 frontend/ 上跳一级；npx playwright test 的 cwd = frontend）。
const SCREENSHOT = path.resolve(
  process.cwd(),
  "..",
  ".sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-file-card-2026-10-21.png",
);
const LONG_LIST_SCREENSHOT = path.resolve(
  process.cwd(),
  "..",
  ".sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-file-card-100files-2026-10-21.png",
);

test.use({ viewport: { width: 1400, height: 900 } });

test("文件变更卡：折叠 / 展开 / 降级三态与 100 文件内滚", async ({ page }) => {
  const errors: string[] = [];
  const callbackLogs: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.text().startsWith("[proto] onOpenFile:")) callbackLogs.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/proto/session-file-changes", { waitUntil: "domcontentloaded" });

  // ── 三张卡 + 折叠态读数 ──
  await expect(page.getByTestId("file-changes-card")).toHaveCount(3);
  const first = page.getByTestId("file-changes-card").nth(0);
  await expect(first.getByText("已编辑 8 个文件")).toBeVisible();
  await expect(first.getByText("+230")).toBeVisible();
  await expect(first.getByText("−8")).toBeVisible();
  await expect(first).toHaveAttribute("data-expanded", "false");
  await expect(first.getByTestId("file-changes-row")).toHaveCount(0);

  const headerBox = await first.getByTestId("file-changes-header").boundingBox();
  expect(headerBox).not.toBeNull();
  expect(Math.round(headerBox!.height)).toBe(28);

  // ── 降级态的静态标记（此时第 1 张卡仍折叠，全页「命令行」只在展开后出现）──
  await expect(page.getByText("共享工作区，可能含并行会话改动")).toHaveCount(1);
  await expect(page.getByText("（部分）")).toHaveCount(1);
  await expect(page.getByText("已编辑 12 个文件")).toBeVisible();
  // 超时快照的行级统计不可信：第 3 张卡头部不出现 +/− 数字。
  const thirdHeaderText = await page
    .getByTestId("file-changes-card")
    .nth(2)
    .getByTestId("file-changes-header")
    .innerText();
  expect(thirdHeaderText).not.toContain("+");
  expect(thirdHeaderText).not.toContain("−");

  // ── 展开：8 行、24px、命令行徽标恰一次 ──
  await first.getByTestId("file-changes-header").click();
  await expect(first).toHaveAttribute("data-expanded", "true");
  await expect(first.getByTestId("file-changes-row")).toHaveCount(8);
  const rowBox = await first.getByTestId("file-changes-row").first().boundingBox();
  expect(rowBox).not.toBeNull();
  expect(Math.round(rowBox!.height)).toBe(24);
  await expect(page.getByText("命令行", { exact: true })).toHaveCount(1);

  // ── 点行 → onOpenFile 生效（可见 state + console.log 双证据）──
  await first
    .getByTestId("file-changes-row")
    .filter({ hasText: "turn-timeline.tsx" })
    .click();
  await expect(page.getByTestId("open-file-log")).toContainText(
    "frontend/src/components/daemon/turn-timeline.tsx",
  );
  expect(callbackLogs.length).toBeGreaterThan(0);

  // ── 截图（1400×900 视口；先把鼠标移开行，避免把 hover 态当成静息态）──
  await page.mouse.move(10, 10);
  await page.screenshot({ path: SCREENSHOT });

  // ── 100 文件长列表：按钮后出现，列表限高内滚 ──
  await page.getByTestId("toggle-long-list").click();
  await expect(page.getByTestId("file-changes-card")).toHaveCount(4);
  const longCard = page.getByTestId("file-changes-card").nth(3);
  await expect(longCard.getByTestId("file-changes-row")).toHaveCount(100);
  const scrollBox = await longCard.getByTestId("file-changes-list").evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  // 限高 240px，扣掉 1px 上边框后内容区 239px（border-box）——留一点容差。
  expect(scrollBox.clientHeight).toBeLessThanOrEqual(240);
  expect(scrollBox.clientHeight).toBeGreaterThan(230);
  expect(scrollBox.scrollHeight).toBeGreaterThan(240);

  // 滚到底：头部不随滚动移出，第 100 行可见。
  await longCard.getByTestId("file-changes-list").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(longCard.getByTestId("file-changes-header")).toBeVisible();
  await expect(longCard.getByTestId("file-changes-row").last()).toBeVisible();
  await longCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: LONG_LIST_SCREENSHOT });

  // ── 零错误 ──
  expect(errors).toEqual([]);
});
