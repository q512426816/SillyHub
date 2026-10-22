/**
 * 过程行语义标签词表单测（D-025@v1 / 2026-10-20-session-page-dsh-alignment）。
 *
 * 锁定的是「展示层映射」这一份契约：18 个用例覆盖七类标签、词表外工具、
 * 空工具名、错误状态压过类别、大小写不敏感与 mcp__ 前缀。组件侧的可见断言
 * 在 turn-segment-views.test.tsx（Bash 行渲染「运行命令」、Read 行渲染「读写文件」）。
 */
import { describe, expect, it } from "vitest";

import { processLabel } from "../process-labels";

describe("processLabel 固定语义标签词表（D-025）", () => {
  it("thinking → 思考（图标 💭）", () => {
    expect(processLabel("thinking")).toEqual({ label: "思考", icon: "💭" });
  });

  it("Bash → 运行命令（图标 💻）", () => {
    expect(processLabel("tool", "Bash", "ok")).toEqual({ label: "运行命令", icon: "💻" });
  });

  it("Pwsh / PowerShell / Shell / terminal_send → 运行命令", () => {
    for (const name of ["Pwsh", "PowerShell", "Shell", "terminal_send", "terminal_send_keys"]) {
      expect(processLabel("tool", name, "ok").label).toBe("运行命令");
    }
  });

  it("Read → 读写文件（图标 📂）", () => {
    expect(processLabel("tool", "Read", "ok")).toEqual({ label: "读写文件", icon: "📂" });
  });

  it("Write / Edit / MultiEdit / NotebookEdit / str_replace_editor → 读写文件", () => {
    for (const name of ["Write", "Edit", "MultiEdit", "NotebookEdit", "str_replace_editor"]) {
      expect(processLabel("tool", name, "ok").label).toBe("读写文件");
    }
  });

  it("Grep → 搜索（图标 🔍）", () => {
    expect(processLabel("tool", "Grep", "ok")).toEqual({ label: "搜索", icon: "🔍" });
  });

  it("Glob / WebSearch / web_fetch / CodebaseSearch → 搜索", () => {
    for (const name of ["Glob", "WebSearch", "web_fetch", "CodebaseSearch"]) {
      expect(processLabel("tool", name, "ok").label).toBe("搜索");
    }
  });

  it("text → 回复（助手正文段词表预留；当前无折叠头，不额外造头）", () => {
    expect(processLabel("text")).toEqual({ label: "回复", icon: "💬" });
  });

  it("词表外工具名 → 其它（绝不丢行）", () => {
    expect(processLabel("tool", "SomeBrandNewTool", "ok")).toEqual({
      label: "其它",
      icon: "🔧",
    });
  });

  it("空 / null 工具名 → 其它（孤儿 result 段也必须有标签）", () => {
    expect(processLabel("tool", null, null).label).toBe("其它");
    expect(processLabel("tool", "   ", undefined).label).toBe("其它");
  });

  it("错误状态压过类别：Bash + error → 失败，而不是运行命令", () => {
    expect(processLabel("tool", "Bash", "error")).toEqual({ label: "失败", icon: "⚠" });
    expect(processLabel("tool", "Read", "error").label).toBe("失败");
  });

  it("deny（被拒/失败）同样判失败：压过工具类别", () => {
    expect(processLabel("tool", "Bash", "deny").label).toBe("失败");
    expect(processLabel("tool", "Grep", "deny").label).toBe("失败");
  });

  it("failed 别名同样判失败", () => {
    expect(processLabel("tool", "Edit", "failed").label).toBe("失败");
  });

  it("错误状态对 thinking / text 行同样优先（任何行 status=error → 失败）", () => {
    expect(processLabel("thinking", null, "error").label).toBe("失败");
    expect(processLabel("text", null, "error").label).toBe("失败");
  });

  it("大小写不敏感：bash / BASH / ReAd / gReP 命中同一类别", () => {
    expect(processLabel("tool", "bash", "ok").label).toBe("运行命令");
    expect(processLabel("tool", "BASH", "ok").label).toBe("运行命令");
    expect(processLabel("tool", "ReAd", "ok").label).toBe("读写文件");
    expect(processLabel("tool", "gReP", "ok").label).toBe("搜索");
  });

  it("mcp__<server>__<tool> 前缀按末段匹配（展示名仍由组件原样渲染）", () => {
    expect(processLabel("tool", "mcp__sillyhub__Bash", "ok").label).toBe("运行命令");
    expect(processLabel("tool", "mcp__sillyhub__Read", "ok").label).toBe("读写文件");
    expect(processLabel("tool", "mcp__sillyhub__dispatch_worker", "ok").label).toBe("其它");
  });

  it("ok / running 状态不改变类别标签（只有错误状态才压类别）", () => {
    expect(processLabel("tool", "Bash", "ok").label).toBe("运行命令");
    expect(processLabel("tool", "Bash", "running").label).toBe("运行命令");
  });

  it("标签字面量严格属于七类词表（思考/运行命令/读写文件/搜索/回复/失败/其它）", () => {
    const VOCAB = new Set(["思考", "运行命令", "读写文件", "搜索", "回复", "失败", "其它"]);
    const samples = [
      processLabel("thinking"),
      processLabel("tool", "Bash", "ok"),
      processLabel("tool", "Read", "ok"),
      processLabel("tool", "Grep", "ok"),
      processLabel("text"),
      processLabel("tool", "Bash", "error"),
      processLabel("tool", "Unknown", "ok"),
    ];
    for (const item of samples) expect(VOCAB.has(item.label)).toBe(true);
  });
});
