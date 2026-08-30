// task-12（2026-08-31-session-queue-ux / FR-07 / R-06）：CopyButton 消息复制按钮单测。
//
// 覆盖维度（design §8「CopyButton 复制/失败反馈、三类气泡挂载」的组件级行为规格）：
//   1. 渲染门槛——text 非空渲染按钮（默认 aria-label「复制」+ 文案「⧉ 复制」，可
//      自定义 ariaLabel）；text 空串 / undefined 整钮不渲染（纯附件气泡不留空按钮）；
//   2. 成功路径——点击 navigator.clipboard.writeText 收到纯文本，文案切「✓ 已复制」
//      （aria-label 同步「已复制」），fake timers 推进 1200ms 后复位回「⧉ 复制」；
//   3. 降级路径（R-06 静默，不抛错 / 不阻塞聊天）——clipboard 不可用
//      （navigator.clipboard undefined，http 局域网非安全上下文）与 writeText reject
//      两路均 console.warn + 短暂「复制失败」反馈；
//   4. getText 惰性形态——渲染期不调用，点击时取当时返回值（同传 text 时 getText
//      优先）；返回 null 时空值守卫直接返回，不触达 clipboard 也不告警。
//
// 测试纪律：FIRST / AAA / 断言真实渲染输出 / 零 mock 被测组件。clipboard mock 用
// Object.defineProperty 逐用例覆写 + afterEach 删除还原（jsdom 非安全上下文无
// navigator.clipboard，「不可用」用例依赖该基态，避免用例间污染）；console.warn
// spy 用完即 mockRestore（不吞后续用例的真实告警）。jsdom 无 :hover——hover 浮出
// 是纯 CSS 行为（group-hover:opacity-100），不在断言范围，只断言按钮 DOM 常驻可点。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { CopyButton } from "../copy-button";

/* jsdom 默认无 navigator.clipboard（非安全上下文）；本文件逐用例 defineProperty
   覆写（configurable），afterEach 删除还原，保证「clipboard 不可用」用例的基态。 */
afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("CopyButton 渲染门槛", () => {
  it("text 非空：渲染按钮，默认 aria-label「复制」+ 文案「⧉ 复制」", () => {
    render(<CopyButton text="答复正文" />);
    const btn = screen.getByRole("button", { name: "复制" });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toBe("⧉ 复制");
  });

  it("自定义 ariaLabel 覆盖默认「复制」", () => {
    const { unmount } = render(<CopyButton text="答复正文" ariaLabel="复制答复" />);
    expect(screen.getByRole("button", { name: "复制答复" })).toBeInTheDocument();
    unmount();
    render(<CopyButton text="答复正文" />);
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
  });

  it("text 空串 / undefined：整钮不渲染（纯附件气泡不留空按钮）", () => {
    const { unmount } = render(<CopyButton text="" />);
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    render(<CopyButton />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("CopyButton 成功路径", () => {
  it("点击复制成功：writeText 收纯文本 + 文案切「✓ 已复制」（aria-label 同步）+ 1200ms 后复位", async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      render(<CopyButton text="答复正文" />);
      const btn = screen.getByRole("button", { name: "复制" });
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith("答复正文");
      // 成功反馈窗口：文案与 aria-label 同步切换为「已复制」
      expect(btn.textContent).toBe("✓ 已复制");
      expect(screen.getByRole("button", { name: "已复制" })).toBe(btn);
      // 未到 1200ms 不复位；到达后复位回 idle 态
      act(() => {
        vi.advanceTimersByTime(1_199);
      });
      expect(btn.textContent).toBe("✓ 已复制");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(btn.textContent).toBe("⧉ 复制");
      expect(screen.getByRole("button", { name: "复制" })).toBe(btn);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CopyButton 降级路径（R-06 静默，不阻塞聊天）", () => {
  it("clipboard 不可用（navigator.clipboard undefined）：点击不抛错 + console.warn + 短暂「复制失败」", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<CopyButton text="答复正文" />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "复制" }))).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("复制失败");
    expect(screen.getByRole("button", { name: "复制" }).textContent).toBe("复制失败");
    warnSpy.mockRestore();
  });

  it("writeText reject：同样 console.warn 静默降级不抛错 + 「复制失败」反馈", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<CopyButton text="答复正文" />);
    // reject 被 .catch(fail) 吞掉，不向点击处抛出（点击不阻塞聊天）
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
    });
    expect(writeText).toHaveBeenCalledWith("答复正文");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("复制失败");
    expect(screen.getByRole("button", { name: "复制" }).textContent).toBe("复制失败");
    warnSpy.mockRestore();
  });
});

describe("CopyButton getText 惰性形态", () => {
  it("渲染期不调用，点击时取当时返回值（同传 text 时 getText 优先）", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    let current: string | null = "第一版文本";
    const getText = vi.fn(() => current);
    render(<CopyButton text="静态旧值" getText={getText} />);
    expect(getText).not.toHaveBeenCalled(); // 惰性：渲染期零调用
    const btn = screen.getByRole("button", { name: "复制" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(getText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("第一版文本"); // getText 优先于同传 text
    // 点击期再取值（用户气泡剥离附件标记场景：值变化后取当时值）
    current = "第二版文本";
    await act(async () => {
      fireEvent.click(btn); // 反馈期内同钮复点仍走 getText
    });
    expect(writeText).toHaveBeenLastCalledWith("第二版文本");
  });

  it("getText 返回 null：空值守卫直接返回，不触达 clipboard 也不告警", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<CopyButton getText={() => null} />);
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(writeText).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "复制" }).textContent).toBe("⧉ 复制"); // 保持 idle
    warnSpy.mockRestore();
  });
});
