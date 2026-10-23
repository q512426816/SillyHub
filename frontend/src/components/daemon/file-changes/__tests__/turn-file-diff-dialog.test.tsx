// 2026-10-23-turn-file-diff-dialog task-02：TurnFileDiffDialog 组件单测。
//
// 锁定契约（FR-01/02/03）：
//   1. open=true 拉本轮日志，命中补丁 → 弹窗渲染路径 + 按次分段 DiffView（红删绿增行）；
//   2. 同文件多次编辑 → 第 1 次/第 2 次…逐段（FR-02）；
//   3. 无补丁（shell 归因 / 配不到）→ 如实说明原因，不出伪造 diff（FR-03）；
//   4. 加载中/失败（可重试）两态；open=false 不渲染、不拉数。
//
// 测试纪律：mock @/lib/daemon/sessions（日志 API 零真网）；DiffView 用真件
// （渲染行是本组件核心契约，mock 掉反而锁不住行号/加减号）。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TurnFileDiffDialog } from "../turn-file-diff-dialog";
import type { AgentRunLogEntry } from "@/lib/agent";

const getAgentSessionLogsMock = vi.fn();
vi.mock("@/lib/daemon/sessions", () => ({
  getAgentSessionLogs: (...args: unknown[]) => getAgentSessionLogsMock(...args),
}));

// 2026-10-23-diff-dialog-copy-fallback：剪贴板零副作用 mock（断言复制内容）。
const copyTextToClipboardMock = vi.fn((_text: string) => Promise.resolve());
vi.mock("@/lib/clipboard", () => ({
  copyTextToClipboard: (text: string) => copyTextToClipboardMock(text),
}));

function callLog(toolUseId: string, filePath: string, tool = "Edit"): AgentRunLogEntry {
  return {
    id: `call-${toolUseId}`,
    run_id: "run-1",
    timestamp: "2026-10-23T08:00:00Z",
    channel: "tool_call",
    content_redacted: JSON.stringify({ tool, args: { file_path: filePath }, tool_use_id: toolUseId }),
    tool_use_id: toolUseId,
  };
}

function resultLog(toolUseId: string, lines: string[]): AgentRunLogEntry {
  return {
    id: `result-${toolUseId}`,
    run_id: "run-1",
    timestamp: "2026-10-23T08:00:01Z",
    channel: "stdout",
    content_redacted: "[TOOL_RESULT] ok",
    edit_patch: JSON.stringify([{ oldStart: 1, newStart: 1, lines }]),
    tool_use_id: toolUseId,
  };
}

function renderDialog(
  overrides: Partial<Parameters<typeof TurnFileDiffDialog>[0]> = {},
) {
  return render(
    <TurnFileDiffDialog
      sessionId="sess-1"
      runKey="run-1"
      path="frontend/src/a.ts"
      open
      onOpenChange={() => {}}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  getAgentSessionLogsMock.mockReset();
});

describe("TurnFileDiffDialog", () => {
  it("命中补丁：渲染路径标题 + 第 1 次 Edit 分段 + 行级 diff（红删绿增）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([
      callLog("tu-1", "frontend/src/a.ts"),
      resultLog("tu-1", ["-old line", "+new line"]),
    ]);
    renderDialog();

    expect(await screen.findByTestId("turn-file-diff-dialog")).toBeDefined();
    expect(screen.getByText("frontend/src/a.ts")).toBeDefined();
    expect(screen.getByText(/第 1 次/)).toBeDefined();
    expect(screen.getByText(/Edit/)).toBeDefined();
    expect(screen.getByText("old line")).toBeDefined();
    expect(screen.getByText("new line")).toBeDefined();
    // 有补丁态：副标题带「来自 agent 编辑日志」语义。
    expect(screen.getByText(/来自 agent 编辑日志/)).toBeDefined();
    // 拉取参数：会话级单轮日志 API（run_id 定轮）。
    expect(getAgentSessionLogsMock).toHaveBeenCalledWith("sess-1", expect.objectContaining({ runId: "run-1" }));
  });

  it("同文件多次编辑：第 1/2 次分段齐全（FR-02）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([
      callLog("tu-1", "frontend/src/a.ts"),
      resultLog("tu-1", ["-one"]),
      callLog("tu-2", "frontend/src/a.ts", "MultiEdit"),
      resultLog("tu-2", ["+two"]),
    ]);
    renderDialog();

    expect(await screen.findByText(/第 1 次/)).toBeDefined();
    expect(screen.getByText(/第 2 次/)).toBeDefined();
    expect(screen.getByText(/MultiEdit/)).toBeDefined();
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
  });

  it("shell 归因无补丁：如实说明改动来源不唯一，不出伪造 diff（FR-03/grouping FR-04）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([]);
    renderDialog();

    const body = (await screen.findByTestId("turn-file-diff-body")).textContent!;
    // 如实表述：不断言唯一原因（命令行/并行会话/其他进程并列），不出「该文件由
    // 命令行/脚本改动」断言句式。
    expect(body).toContain("未来自本轮 agent 的编辑工具");
    expect(body).toContain("命令行/脚本");
    expect(body).toContain("并行会话");
    expect(body).not.toContain("该文件由命令行/脚本改动");
    // 无补丁说明态：副标题不带「来自 agent 编辑日志」语义。
    expect(screen.queryByText(/来自 agent 编辑日志/)).toBeNull();
    expect(screen.queryByTestId("turn-file-diff-section")).toBeNull();
  });

  it("删除文件无补丁：如实说明本轮被删除且删除动作未来自编辑工具（grouping FR-03）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([]);
    renderDialog({ status: "deleted" });

    const body = (await screen.findByTestId("turn-file-diff-body")).textContent!;
    expect(body).toContain("本轮被删除");
    expect(body).toContain("未来自编辑工具");
    expect(screen.queryByTestId("turn-file-diff-section")).toBeNull();
  });

  it("tool 归因但配不到补丁：如实说明无证据，不出空壳成功 diff", async () => {
    getAgentSessionLogsMock.mockResolvedValue([
      callLog("tu-1", "frontend/src/other.ts"),
      resultLog("tu-1", ["+x"]),
    ]);
    renderDialog();

    expect(
      await screen.findByText(/未来自本轮 agent 的编辑工具/s),
    ).toBeDefined();
    expect(screen.queryByTestId("turn-file-diff-section")).toBeNull();
  });

  // 2026-10-24-pi-edit-patch-synth / FR-04：agent 编辑归因（改N次>0）但无补丁——
  // 文案如实说「确实来自 agent 编辑但运行时未上报补丁」，禁止甩锅命令行。
  it("agent 编辑过但无补丁（pi 存量轮次）：区分文案，不再断言「未来自编辑工具」", async () => {
    getAgentSessionLogsMock.mockResolvedValue([]);
    renderDialog({ agentEdited: true });

    const body = (await screen.findByTestId("turn-file-diff-body")).textContent!;
    expect(body).toContain("确实来自本轮 agent 的编辑工具");
    expect(body).toContain("未上报结构化补丁");
    expect(body).not.toContain("未来自本轮 agent 的编辑工具");
    expect(body).not.toContain("命令行/脚本");
    expect(screen.queryByTestId("turn-file-diff-section")).toBeNull();
  });

  it("补丁 JSON 不可解析：占位说明段在场（不静默丢弃）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([
      callLog("tu-1", "frontend/src/a.ts"),
      {
        ...resultLog("tu-1", []),
        edit_patch: "{broken",
      },
    ]);
    renderDialog();

    expect(await screen.findByText(/补丁格式不可解析/s)).toBeDefined();
  });

  it("加载中与失败态：失败可重试，重试成功后出内容（FR-03）", async () => {
    getAgentSessionLogsMock.mockRejectedValueOnce(new Error("网络中断"));
    renderDialog();

    expect(await screen.findByText(/加载失败/s)).toBeDefined();
    expect(screen.getByText(/网络中断/)).toBeDefined();

    getAgentSessionLogsMock.mockResolvedValue([
      callLog("tu-1", "frontend/src/a.ts"),
      resultLog("tu-1", ["-old after retry", "+new after retry"]),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(await screen.findByText("new after retry")).toBeDefined();
  });

  it("open=false：不渲染弹窗、不发起拉取", () => {
    getAgentSessionLogsMock.mockResolvedValue([]);
    render(
      <TurnFileDiffDialog
        sessionId="sess-1"
        runKey="run-1"
        path="frontend/src/a.ts"
        open={false}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("turn-file-diff-dialog")).toBeNull();
    expect(getAgentSessionLogsMock).not.toHaveBeenCalled();
  });

  it("等待中无伪造内容：loading 文案在场", async () => {
    getAgentSessionLogsMock.mockReturnValue(new Promise(() => {}));
    renderDialog();
    expect(await screen.findByText(/正在加载本轮编辑补丁/s)).toBeDefined();
    expect(screen.queryByTestId("turn-file-diff-section")).toBeNull();
  });
});

// 2026-10-23-diff-dialog-copy-fallback：超长 diff 复制兜底（FR-01~03）。
describe("TurnFileDiffDialog：复制兜底（2026-10-23-diff-dialog-copy-fallback）", () => {
  afterEach(() => {
    copyTextToClipboardMock.mockClear();
  });

  it("每段补丁有常显复制按钮，点击写入完整 diff 文本（FR-01）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([
      callLog("tu-1", "frontend/src/a.ts"),
      resultLog("tu-1", ["-old line", "+new line"]),
    ]);
    renderDialog();

    const button = await screen.findByRole("button", { name: "复制该段 diff" });
    // 常显：不依赖父容器 hover（opacity-100 + static 覆盖默认浮出定位）。
    expect(button.className).toContain("opacity-100");
    expect(button.className).toContain("static");

    fireEvent.click(button);
    expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1);
    expect(copyTextToClipboardMock).toHaveBeenCalledWith("-old line\n+new line");
  });

  it("超 2000 行：复制内容不截断（渲染上限不进复制面，FR-02）", async () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `+row-${i}`);
    getAgentSessionLogsMock.mockResolvedValue([
      callLog("tu-1", "frontend/src/a.ts"),
      resultLog("tu-1", lines),
    ]);
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "复制该段 diff" }));
    const copied = copyTextToClipboardMock.mock.calls[0]?.[0] ?? "";
    const copiedLines = copied.split("\n");
    expect(copiedLines).toHaveLength(2500);
    expect(copiedLines[2499]).toBe("+row-2499");
  });

  it("无补丁说明态 / 删除说明态不出现复制按钮（FR-03）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([]);
    const { unmount } = renderDialog();
    // 2026-10-23-diff-copy-p3-cleanup / FR-03：先等说明文案出现（确认 ready 且无
    // sections），loading 态即存在的 body 节点不能作为 ready 判据。
    expect(
      await screen.findByText(/未来自本轮 agent 的编辑工具/s),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /复制该段 diff/ })).toBeNull();
    unmount();

    getAgentSessionLogsMock.mockResolvedValue([]);
    renderDialog({ status: "deleted" });
    expect(await screen.findByText(/本轮被删除/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /复制该段 diff/ })).toBeNull();
  });
});

// 2026-10-23-diff-copy-p3-cleanup / FR-02：脚注如实声明复制文本边界。
describe("TurnFileDiffDialog：复制边界脚注（2026-10-23-diff-copy-p3-cleanup）", () => {
  it("补丁区脚注声明复制文本不含 hunk 头、不可直接 git apply", async () => {
    getAgentSessionLogsMock.mockResolvedValue([
      callLog("tu-1", "frontend/src/a.ts"),
      resultLog("tu-1", ["-old", "+new"]),
    ]);
    renderDialog();

    const footnote = await screen.findByText(/不可直接用于 git apply/);
    expect(footnote.textContent).toContain("行级文本");
    expect(footnote.textContent).toContain("hunk 头");
  });

  it("复制按钮点击期取值（getText 惰性），复制内容不变（FR-01）", async () => {
    getAgentSessionLogsMock.mockResolvedValue([
      callLog("tu-1", "frontend/src/a.ts"),
      resultLog("tu-1", ["-lazy", "+computed"]),
    ]);
    renderDialog();

    // 渲染完成未点击：剪贴板零调用（惰性取值路径不预先构建文本）。
    await screen.findByTestId("turn-file-diff-section");
    expect(copyTextToClipboardMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "复制该段 diff" }));
    expect(copyTextToClipboardMock).toHaveBeenCalledWith("-lazy\n+computed");
  });
});
