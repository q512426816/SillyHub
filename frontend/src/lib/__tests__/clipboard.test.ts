/**
 * 2026-10-12-clipboard-fallback：copyTextToClipboard 单测。
 *
 * 覆盖：
 *   1. 安全上下文（navigator.clipboard.writeText 存在）→ 委托 Async Clipboard API，
 *      不走 execCommand 降级
 *   2. 非安全上下文（clipboard 缺失，HTTP 局域网主部署形态）→ textarea + execCommand
 *      降级：execCommand 被调 'copy'、临时节点清理、既有选区恢复
 *   3. 降级失败（execCommand 返回 false）→ 抛错且节点仍被清理
 *
 * jsdom 不实现 document.execCommand（原型链上也无），统一用 defineProperty 桩。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "@/lib/clipboard";

function stubExecCommand(impl: () => boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  Object.defineProperty(document, "execCommand", {
    value: fn,
    configurable: true,
    writable: true,
  });
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  document.body.innerHTML = "";
});

describe("copyTextToClipboard（2026-10-12-clipboard-fallback）", () => {
  it("安全上下文：委托 navigator.clipboard.writeText，不走 execCommand", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const execCommand = stubExecCommand(() => true);

    await copyTextToClipboard("secret-1");

    expect(writeText).toHaveBeenCalledWith("secret-1");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("非安全上下文（clipboard 缺失）：textarea + execCommand 降级，节点清理、选区恢复", async () => {
    Reflect.deleteProperty(navigator, "clipboard");
    const execCommand = stubExecCommand(() => true);
    const addRange = vi.fn();
    const removeAllRanges = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => ({}) as Range,
      removeAllRanges,
      addRange,
    } as unknown as Selection);

    // 回归复审 FR-05：select 原型 spy 钉「选区真被产生」——删掉 helper 的
    // textarea.select() 本用例必须红（防守卫退化为摆设）。
    const selectSpy = vi.spyOn(HTMLTextAreaElement.prototype, "select");
    await copyTextToClipboard("shk_live_secret123");

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith("copy");
    // 临时节点已清理（body 无残留 textarea）。
    expect(document.body.querySelectorAll("textarea")).toHaveLength(0);
    expect(addRange).toHaveBeenCalled();
  });

  it("降级失败（execCommand 返回 false）→ 抛错且节点仍被清理（finally 保证）", async () => {
    Reflect.deleteProperty(navigator, "clipboard");
    stubExecCommand(() => false);

    await expect(copyTextToClipboard("x")).rejects.toThrow(/剪贴板写入/);
    expect(document.body.querySelectorAll("textarea")).toHaveLength(0);
  });
});
