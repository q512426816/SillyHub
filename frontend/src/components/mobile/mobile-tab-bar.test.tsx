/**
 * task-04 · 移动底部 5 Tab 单测（design §5.4 / D-004 / FR-02）。
 *
 * 覆盖：
 * - 渲染 5 个 Tab，文案与目标路径正确（href = 原始路径，rewrite 由 task-01 middleware 负责）。
 * - 当前路径对应 Tab 高亮（aria-current="page" + data-active="true"）。
 * - 子路径前缀匹配同样高亮。
 * - activeTab 受控覆盖路由推断。
 * - 点击 Tab 触发导航（mock next/link 记录 href；mock next/navigation 提供 usePathname）。
 * - isTabActive 纯函数前缀匹配语义。
 *
 * mock 策略与 components/__tests__/top-bar.test.tsx 一致：jsdom 下 next/navigation
 * 需 mock；next/link mock 成带 href 的 <a>，并把点击 href 记入可变 ref 以验证导航目标。
 */

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { pathnameRef, navHref } = vi.hoisted(() => ({
  pathnameRef: { current: "/ppm/workbench" },
  navHref: { current: "" as string },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a
      href={String(href)}
      onClick={(e) => {
        e.preventDefault();
        navHref.current = String(href);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

import {
  isTabActive,
  MOBILE_TABS,
  MobileTabBar,
} from "@/components/mobile/mobile-tab-bar";

describe("MobileTabBar 渲染", () => {
  afterEach(() => {
    pathnameRef.current = "/ppm/workbench";
    navHref.current = "";
  });

  it("恰好渲染 5 个 Tab", () => {
    render(<MobileTabBar />);
    // 5 个 Tab 各对应一个 data-tab-key 锚点（getByTestId 返回唯一 nav，规避 noUncheckedIndexedAccess）
    const links = screen
      .getByTestId("mobile-tab-bar")
      .querySelectorAll("a[data-tab-key]");
    expect(links).toHaveLength(5);
    expect(MOBILE_TABS).toHaveLength(5);
  });

  it("5 Tab 文案与目标路径（href）正确", () => {
    render(<MobileTabBar />);
    for (const tab of MOBILE_TABS) {
      const label = screen.getByText(tab.label);
      const anchor = label.closest("a");
      expect(anchor).toBeTruthy();
      expect(anchor?.getAttribute("href")).toBe(tab.href);
    }
    // 显式断言 5 条目标路径（FR-02）
    expect(screen.getByText("工作台").closest("a")?.getAttribute("href")).toBe(
      "/ppm/workbench",
    );
    expect(screen.getByText("计划任务").closest("a")?.getAttribute("href")).toBe(
      "/ppm/task-plans",
    );
    expect(screen.getByText("问题清单").closest("a")?.getAttribute("href")).toBe(
      "/ppm/problem-list",
    );
    expect(screen.getByText("我的").closest("a")?.getAttribute("href")).toBe(
      "/account",
    );
    expect(screen.getByText("平台切换").closest("a")?.getAttribute("href")).toBe(
      "/workspaces",
    );
  });
});

describe("MobileTabBar 高亮", () => {
  afterEach(() => {
    pathnameRef.current = "/ppm/workbench";
    navHref.current = "";
  });

  it("当前路径对应 Tab 高亮（aria-current=page, data-active=true）", () => {
    pathnameRef.current = "/ppm/task-plans";
    render(<MobileTabBar />);

    const active = screen.getByText("计划任务").closest("a");
    expect(active?.getAttribute("aria-current")).toBe("page");
    expect(active?.getAttribute("data-active")).toBe("true");

    const inactive = screen.getByText("工作台").closest("a");
    expect(inactive?.getAttribute("aria-current")).toBeNull();
    expect(inactive?.getAttribute("data-active")).toBe("false");
  });

  it("子路径前缀匹配同样高亮对应 Tab", () => {
    pathnameRef.current = "/ppm/problem-list/123";
    render(<MobileTabBar />);
    expect(
      screen.getByText("问题清单").closest("a")?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByText("工作台").closest("a")?.getAttribute("aria-current"),
    ).toBeNull();
  });

  it("activeTab 受控覆盖路由推断", () => {
    pathnameRef.current = "/ppm/workbench";
    render(<MobileTabBar activeTab="switch" />);
    expect(
      screen.getByText("平台切换").closest("a")?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByText("工作台").closest("a")?.getAttribute("aria-current"),
    ).toBeNull();
  });
});

describe("MobileTabBar 导航", () => {
  afterEach(() => {
    pathnameRef.current = "/ppm/workbench";
    navHref.current = "";
  });

  it("点击 Tab 触发导航到目标路径", () => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByText("问题清单"));
    expect(navHref.current).toBe("/ppm/problem-list");
  });

  it("点击平台切换 Tab 导航到 /workspaces", () => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByText("平台切换"));
    expect(navHref.current).toBe("/workspaces");
  });
});

describe("isTabActive 纯函数", () => {
  it("精确命中与前缀命中均为 true，其它路径 false", () => {
    const workbench = MOBILE_TABS.find((t) => t.key === "workbench")!;
    expect(isTabActive(workbench, "/ppm/workbench")).toBe(true);
    expect(isTabActive(workbench, "/ppm/workbench/detail/9")).toBe(true);
    expect(isTabActive(workbench, "/ppm/task-plans")).toBe(false);
  });

  it("不误判同前缀的相邻域名（/ppm/task-plans 不命中 /ppm/task-plans-x）", () => {
    // matchPrefix + "/" 语义：/ppm/task-plans-xxx 不应被 /ppm/task-plans 命中
    const taskPlans = MOBILE_TABS.find((t) => t.key === "task-plans")!;
    expect(isTabActive(taskPlans, "/ppm/task-plans-extra")).toBe(false);
    expect(isTabActive(taskPlans, "/ppm/task-plans")).toBe(true);
  });
});
