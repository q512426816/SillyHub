// task-07（2026-09-22-session-fork-continuation / FR-01 / FR-04）：轮级分叉入口
// 三重门控矩阵 + 确认弹层两档文案 + 确认调用断言 + 错误透出 单测。
//
// 覆盖（对照原型 prototype-session-fork.html 轮头入口节 + 确认弹层节）：
//   1. 门控一（caps）：sessionFork=none（cursor / 未知引擎）不渲染入口；
//   2. 门控二（终态）：run 进行中三态（pending/running/interrupting）置灰
//      「⑂ 进行中不可分叉」，点击不触发 onFork；
//   3. 门控三（锚点）：native 档（claude/pi）锚点缺失（null/undefined）置灰
//      「⑂ 该轮缺少引擎锚点」；seed 档（codex）无锚点门控可点；
//   4. 可点态文案「⑂ 从此分叉」+ 点击 onFork 上抛（挂载接线归 task-08）；
//   5. 弹层两档语义标注：native=「原生分叉·真截断」/ seed=「种子分叉·前情
//      转述（非原生上下文）」（FR-04 验收文案，勿改措辞）；
//   6. 确认调 forkSession(sessionId, {at_run_id}) 且成功 onForked 回执上抛；
//   7. 409/422 ApiError 文案行内透出（role=alert），onForked 不触发、按钮复位；
//   8. 取消不触发任何请求；
//   9. forkSession 封装 URL/method/body 透传（encodeURIComponent 口径）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/daemon", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    forkSession: vi.fn(),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    apiFetch: vi.fn(),
  };
});

import { TurnForkEntry } from "@/components/daemon/turn-segment-views";
import { ForkConfirmModal } from "@/components/daemon/session-fork/fork-confirm-modal";
import { forkSession } from "@/lib/daemon";
import type { SessionForkResponse } from "@/lib/daemon";
import { ApiError, apiFetch } from "@/lib/api";

const forkMock = vi.mocked(forkSession);
const fetchMock = vi.mocked(apiFetch);

const FORK_RESPONSE: SessionForkResponse = {
  forked_session_id: "fs-1",
  lease_id: "lease-1",
  run_id: "run-b1",
  tier: "native",
  lineage: {
    source_session_id: "sess-1",
    source_title: "重构方案讨论",
    at_run_seq: 2,
  },
};

const MODAL_PROPS = {
  sessionId: "sess-1",
  atRunId: "run-2",
  atRunSeq: 2,
  sourceTitle: "重构方案讨论",
  provider: "claude",
};

describe("TurnForkEntry 三重门控矩阵", () => {
  beforeEach(() => {
    forkMock.mockReset();
  });

  it("门控一：caps=none（cursor）不渲染入口", () => {
    const onFork = vi.fn();
    const { container } = render(
      <TurnForkEntry provider="cursor" runStatus="completed" engineAnchor={null} onFork={onFork} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("门控一：未知 provider 回退 none 同样不渲染（R-09 默认拒绝）", () => {
    const { container } = render(
      <TurnForkEntry provider="unknown-engine" runStatus="completed" engineAnchor="a" onFork={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("门控二：run 进行中（running）置灰「进行中不可分叉」，点击不上抛", () => {
    const onFork = vi.fn();
    render(
      <TurnForkEntry provider="claude" runStatus="running" engineAnchor="anchor-1" onFork={onFork} />,
    );
    const btn = screen.getByTestId("turn-fork-entry");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("⑂ 进行中不可分叉");
    fireEvent.click(btn);
    expect(onFork).not.toHaveBeenCalled();
  });

  it("门控二：pending / interrupting 同属进行中口径置灰", () => {
    for (const status of ["pending", "interrupting"]) {
      const { unmount } = render(
        <TurnForkEntry provider="claude" runStatus={status} engineAnchor="anchor-1" onFork={vi.fn()} />,
      );
      expect(screen.getByTestId("turn-fork-entry")).toBeDisabled();
      unmount();
    }
  });

  it("门控三：native 档（claude）锚点缺失置灰「该轮缺少引擎锚点」，点击不上抛", () => {
    const onFork = vi.fn();
    render(
      <TurnForkEntry provider="claude" runStatus="completed" engineAnchor={null} onFork={onFork} />,
    );
    const btn = screen.getByTestId("turn-fork-entry");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("⑂ 该轮缺少引擎锚点");
    fireEvent.click(btn);
    expect(onFork).not.toHaveBeenCalled();
  });

  it("门控三：锚点 undefined（挂载方数据源未接）同缺失口径置灰", () => {
    render(
      <TurnForkEntry provider="claude" runStatus="completed" onFork={vi.fn()} />,
    );
    expect(screen.getByTestId("turn-fork-entry")).toBeDisabled();
  });

  it("门控三：seed 档（codex）无锚点不受门控，可点「从此分叉」", () => {
    const onFork = vi.fn();
    render(
      <TurnForkEntry provider="codex" runStatus="completed" engineAnchor={null} onFork={onFork} />,
    );
    const btn = screen.getByTestId("turn-fork-entry");
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent("⑂ 从此分叉");
    fireEvent.click(btn);
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  it("通过态：native 档 + 终态轮 + 锚点在，可点并上抛 onFork（pi 同 native 档）", () => {
    const onFork = vi.fn();
    const { rerender } = render(
      <TurnForkEntry provider="claude" runStatus="completed" engineAnchor="anchor-1" onFork={onFork} />,
    );
    let btn = screen.getByTestId("turn-fork-entry");
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent("⑂ 从此分叉");
    fireEvent.click(btn);
    // pi 实测升 native（D-008），同口径可点。
    rerender(
      <TurnForkEntry provider="pi" runStatus="completed" engineAnchor="entry-1" onFork={onFork} />,
    );
    btn = screen.getByTestId("turn-fork-entry");
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onFork).toHaveBeenCalledTimes(2);
  });
});

describe("ForkConfirmModal 档位语义标注与确认链路", () => {
  beforeEach(() => {
    forkMock.mockReset();
  });

  it("native 档文案：「原生分叉·真截断」+ 完全不知情说明 + 分叉点信息", () => {
    render(<ForkConfirmModal {...MODAL_PROPS} onCancel={vi.fn()} onForked={vi.fn()} />);
    expect(screen.getByTestId("fork-confirm-tier-badge")).toHaveTextContent(
      "原生分叉·真截断",
    );
    expect(screen.getByTestId("fork-confirm-tier")).toHaveTextContent("完全不知情");
    expect(screen.getByTestId("fork-confirm-point")).toHaveTextContent(
      "「重构方案讨论」第 2 轮后",
    );
    expect(screen.getByText(/继承快照/)).toBeInTheDocument();
  });

  it("seed 档文案：「种子分叉·前情转述（非原生上下文）」（FR-04 验收措辞）", () => {
    render(<ForkConfirmModal {...MODAL_PROPS} provider="codex" onCancel={vi.fn()} onForked={vi.fn()} />);
    expect(screen.getByTestId("fork-confirm-tier-badge")).toHaveTextContent(
      "种子分叉·前情转述（非原生上下文）",
    );
    expect(screen.getByTestId("fork-confirm-tier")).toHaveTextContent("前情转述");
  });

  it("确认调 forkSession(sessionId, {at_run_id}) 并把回执原样上抛 onForked", async () => {
    forkMock.mockResolvedValueOnce(FORK_RESPONSE);
    const onForked = vi.fn();
    render(<ForkConfirmModal {...MODAL_PROPS} onCancel={vi.fn()} onForked={onForked} />);
    fireEvent.click(screen.getByRole("button", { name: "创建分叉并进入" }));
    await waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
    expect(forkMock).toHaveBeenCalledWith("sess-1", { at_run_id: "run-2" });
    expect(onForked).toHaveBeenCalledWith(FORK_RESPONSE);
  });

  it("409（轮进行中）ApiError 文案行内透出，onForked 不触发、按钮复位可重试", async () => {
    forkMock.mockRejectedValueOnce(
      new ApiError(409, {
        code: "HTTP_409_DAEMON_SESSION_FORK_RUN_ACTIVE",
        message: "分叉点所在轮仍在进行中，请等该轮结束后再分叉。",
        request_id: null,
        details: null,
      }),
    );
    const onForked = vi.fn();
    render(<ForkConfirmModal {...MODAL_PROPS} onCancel={vi.fn()} onForked={onForked} />);
    fireEvent.click(screen.getByRole("button", { name: "创建分叉并进入" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "分叉点所在轮仍在进行中，请等该轮结束后再分叉。",
    );
    expect(onForked).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "创建分叉并进入" })).toBeEnabled();
  });

  it("422（native 锚点缺失）文案透出（含可退种子档提示）", async () => {
    forkMock.mockRejectedValueOnce(
      new ApiError(422, {
        code: "HTTP_422_DAEMON_SESSION_FORK_ANCHOR_MISSING",
        message: "该轮缺少引擎锚点（engine_anchor），无法原生分叉；可改用种子档（前情转述）分叉。",
        request_id: null,
        details: null,
      }),
    );
    render(<ForkConfirmModal {...MODAL_PROPS} onCancel={vi.fn()} onForked={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "创建分叉并进入" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("可改用种子档（前情转述）分叉。");
  });

  it("非 ApiError 异常走通用兜底文案", async () => {
    forkMock.mockRejectedValueOnce(new Error("network down"));
    render(<ForkConfirmModal {...MODAL_PROPS} onCancel={vi.fn()} onForked={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "创建分叉并进入" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("分叉创建失败，请重试");
  });

  it("取消不触发任何请求", () => {
    const onCancel = vi.fn();
    render(<ForkConfirmModal {...MODAL_PROPS} onCancel={onCancel} onForked={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(forkMock).not.toHaveBeenCalled();
  });

  it("防御：none 档（caps 回退）不渲染弹层本体", () => {
    const { container } = render(
      <ForkConfirmModal {...MODAL_PROPS} provider="cursor" onCancel={vi.fn()} onForked={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("forkSession API 封装", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("POST /api/daemon/sessions/{id}/fork，sessionId encodeURIComponent 透传", async () => {
    fetchMock.mockResolvedValueOnce(FORK_RESPONSE);
    // 封装本体（非 mock）：vi.importActual 绕过文件级 daemon mock 取真实实现，
    // 其内部 apiFetch 已被上方 @/lib/api 局部 mock 接管。
    const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
    const resp = await actual.forkSession("sess/1", { at_run_id: "run-2", title: "分叉 B" });
    expect(resp).toEqual(FORK_RESPONSE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/daemon/sessions/sess%2F1/fork", {
      method: "POST",
      json: { at_run_id: "run-2", title: "分叉 B" },
    });
  });
});
