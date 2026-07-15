/**
 * task-07 / FR-01 / FR-03：InstallDaemonBlock 的 OS 自动检测 + 手动切换 + 两 OS 命令 vitest。
 *
 * 覆盖点（对应 task-07.md 验收标准）：
 *  - detectOs 纯函数：Windows UA → "windows"；macOS / Linux UA → "unix"（task-06 export）
 *  - Windows 默认渲染 irm install.ps1 + 琥珀「PowerShell」提示
 *  - unix（macOS/Linux）默认渲染 curl install.sh，不含 irm install.ps1
 *  - 手动切换：点「Windows」按钮从 unix 切到 irm|iex
 *  - 复制按钮写当前 OS 命令到 clipboard
 *
 * 本组件不涉及 markdown / next/dynamic（参考记忆 frontend-markdown-text-jsdom-null 坑不适用），
 * 常规 render 即可。InstallDaemonBlock 不依赖 session store / react-query / next/navigation，
 * 无需 mock（仅 mock navigator.userAgent + clipboard）。
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectOs, InstallDaemonBlock } from "@/app/(dashboard)/runtimes/page";

// ── navigator.userAgent mock 工具 ──────────────────────────────────────────
// jsdom 的 navigator.userAgent 默认是 jsdom-ua（不含 Win），且 navigator 属性只读，
// 必须用 Object.defineProperty + configurable:true 覆盖。
function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

const originalUserAgent = navigator.userAgent;

beforeEach(() => {
  // clipboard mock（InstallDaemonBlock handleCopy 调 navigator.clipboard.writeText）
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  // 还原 UA（避免串到后续用例 / 其它测试文件）。
  setUserAgent(originalUserAgent);
  vi.restoreAllMocks();
});

// ── detectOs 纯函数 ─────────────────────────────────────────────────────────

describe("detectOs（task-06 / FR-01 纯函数）", () => {
  it("Windows UA → \"windows\"", () => {
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
  });

  it("Windows 各种 UA 变体（Win32 / Windows）→ \"windows\"", () => {
    expect(detectOs("Mozilla/5.0 (Windows NT 6.1; Win32)")).toBe("windows");
    expect(detectOs("Mozilla/5.0 (Windows; U) Gecko/20100101")).toBe("windows");
    // 大小写不敏感（/Win/i）
    expect(detectOs("... win64 ...")).toBe("windows");
  });

  it("macOS UA → \"unix\"", () => {
    expect(
      detectOs(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15",
      ),
    ).toBe("unix");
  });

  it("Linux UA → \"unix\"", () => {
    expect(
      detectOs("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"),
    ).toBe("unix");
  });

  it("空串 / 未知 UA → \"unix\"（兜底）", () => {
    expect(detectOs("")).toBe("unix");
    expect(detectOs("Mozilla/5.0 (CrOS x86_64)")).toBe("unix");
  });
});

// ── InstallDaemonBlock 渲染 + 切换 ──────────────────────────────────────────

describe("InstallDaemonBlock（task-06 / FR-02 / D-002）", () => {
  it("展开区块（默认折叠 → 点标题展开）", async () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    render(<InstallDaemonBlock />);
    // 折叠态：标题在，命令区不在。
    expect(screen.getByText("首次安装 daemon（新机器）")).toBeInTheDocument();
    expect(screen.queryByText("macOS / Linux")).not.toBeInTheDocument();

    // 点标题展开。
    fireEvent.click(screen.getByText("首次安装 daemon（新机器）"));
    expect(await screen.findByText("macOS / Linux")).toBeInTheDocument();
    expect(screen.getByText("Windows")).toBeInTheDocument();
  });

  it("Windows UA → 自动渲染 irm install.ps1 + 琥珀「PowerShell」提示", async () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    render(<InstallDaemonBlock />);
    fireEvent.click(screen.getByText("首次安装 daemon（新机器）"));

    // 命令含 irm + install.ps1 + iex
    const code = await screen.findByText(/irm/);
    expect(code.textContent).toMatch(/install\.ps1/);
    expect(code.textContent).toMatch(/iex/);
    // 琥珀提示含 PowerShell
    expect(screen.getByText(/PowerShell/)).toBeInTheDocument();
  });

  it("macOS UA → 渲染 curl install.sh，不含 irm install.ps1", async () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15",
    );
    render(<InstallDaemonBlock />);
    fireEvent.click(screen.getByText("首次安装 daemon（新机器）"));

    const code = await screen.findByText(/curl/);
    expect(code.textContent).toMatch(/install\.sh/);
    expect(code.textContent).toMatch(/bash/);
    // 不含 windows 命令
    expect(code.textContent).not.toMatch(/install\.ps1/);
    // 无 PowerShell 提示（仅 windows 显示）
    expect(screen.queryByText(/PowerShell/)).not.toBeInTheDocument();
  });

  it("Linux UA → 渲染 curl install.sh（与 macOS 同 unix 分支）", async () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    render(<InstallDaemonBlock />);
    fireEvent.click(screen.getByText("首次安装 daemon（新机器）"));

    const code = await screen.findByText(/curl/);
    expect(code.textContent).toMatch(/install\.sh/);
    expect(code.textContent).not.toMatch(/install\.ps1/);
  });

  it("手动切换：unix（mac UA）默认 curl，点「Windows」→ 命令变 irm|iex", async () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15",
    );
    render(<InstallDaemonBlock />);
    fireEvent.click(screen.getByText("首次安装 daemon（新机器）"));

    // 默认 unix：curl
    let code = await screen.findByText(/curl/);
    expect(code.textContent).toMatch(/install\.sh/);

    // 点 Windows 切换按钮（aria-pressed=true 表示激活）
    const winBtn = screen.getByRole("button", { name: "Windows" });
    fireEvent.click(winBtn);

    // 命令切换为 irm|iex + install.ps1
    await waitFor(() => {
      const c = screen.getByText(/irm/);
      expect(c.textContent).toMatch(/install\.ps1/);
      expect(c.textContent).toMatch(/iex/);
    });
    // 切换后出现 PowerShell 提示
    expect(screen.getByText(/PowerShell/)).toBeInTheDocument();
    // Windows 按钮激活（aria-pressed=true）
    expect(screen.getByRole("button", { name: "Windows" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("手动切换：windows 默认 irm，点「macOS / Linux」→ 命令变 curl", async () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    render(<InstallDaemonBlock />);
    fireEvent.click(screen.getByText("首次安装 daemon（新机器）"));

    // 默认 windows：irm
    await screen.findByText(/irm/);

    // 点 macOS / Linux 切换
    fireEvent.click(screen.getByRole("button", { name: "macOS / Linux" }));
    await waitFor(() => {
      const c = screen.getByText(/curl/);
      expect(c.textContent).toMatch(/install\.sh/);
      expect(c.textContent).not.toMatch(/install\.ps1/);
    });
    // PowerShell 提示消失
    expect(screen.queryByText(/PowerShell/)).not.toBeInTheDocument();
  });

  it("复制按钮写当前 OS（unix）命令到 clipboard", async () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    render(<InstallDaemonBlock />);
    fireEvent.click(screen.getByText("首次安装 daemon（新机器）"));
    await screen.findByText(/curl/);

    // 点「复制」按钮（aria-label / title 区分于区块标题里的同名按钮）。
    // 区块内有两个复制相关按钮：「复制」在命令行右侧；用 title 精确定位。
    const copyBtn = screen.getByTitle("复制安装命令");
    fireEvent.click(copyBtn);

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringMatching(/curl.*install\.sh.*bash/),
      ),
    );
  });

  it("复制按钮写 Windows 命令到 clipboard", async () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    render(<InstallDaemonBlock />);
    fireEvent.click(screen.getByText("首次安装 daemon（新机器）"));
    await screen.findByText(/irm/);

    const copyBtn = screen.getByTitle("复制安装命令");
    fireEvent.click(copyBtn);

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringMatching(/irm.*install\.ps1.*iex/),
      ),
    );
  });
});
