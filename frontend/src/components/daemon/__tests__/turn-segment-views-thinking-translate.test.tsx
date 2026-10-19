// 2026-10-19-thinking-zh-translate / FR-04：ThinkingRowView 接入离线翻译的组件测试。
//
// 覆盖维度（会话面板主路径的接入行为）：
//   1. 流式中——折叠摘要显示原文（「思考中」脉冲旁）、零翻译请求；展开正文也显示原文；
//   2. 流结束——折叠摘要自动换中文译文；
//   3. 展开——正文默认译文 + 「显示原文」切换（本地视图切换，不写偏好）；
//   4. 偏好关闭——摘要与正文均原文零请求。
//
// lib/thinking-translate 局部 mock（translateText/isTranslationUnavailable），组件
// 本体零 mock（真实 ThinkingRowView + Collapsible 交互）；store 直用真实 zustand。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

const translateTextMock = vi.fn();
vi.mock("@/lib/thinking-translate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/thinking-translate")>();
  return {
    ...actual,
    translateText: (...args: unknown[]) => translateTextMock(...args),
    isTranslationUnavailable: () => false,
  };
});

import { ThinkingRowView } from "@/components/daemon/turn-segment-views";
import type { ThinkingTurnSegment } from "@/components/daemon/turn-segment-views";
import { useThinkingTranslateStore } from "@/stores/thinking-translate";

const EN = "The agent examines the repository structure and plans the refactor carefully.";
const ZH = "智能体检查了仓库结构并规划重构方案。";

function makeSegment(overrides: Partial<ThinkingTurnSegment> = {}): ThinkingTurnSegment {
  return {
    kind: "thinking",
    id: "seg-1",
    text: EN,
    streaming: false,
    ts: 1700000000000,
    ...overrides,
  } as ThinkingTurnSegment;
}

beforeEach(() => {
  translateTextMock.mockReset();
  act(() => useThinkingTranslateStore.getState().setEnabled(true));
});

function expandRow() {
  fireEvent.click(screen.getByRole("button", { name: /思考过程/ }));
}

describe("ThinkingRowView 离线翻译接入", () => {
  it("流式中：摘要与展开正文均显示原文，零翻译请求", async () => {
    translateTextMock.mockResolvedValue(ZH);
    render(<ThinkingRowView segment={makeSegment({ streaming: true })} />);
    expect(screen.getByText(/The agent examines/)).toBeInTheDocument(); // 折叠摘要=原文
    expect(screen.getByText("思考中")).toBeInTheDocument();
    expandRow();
    expect(await screen.findByText(EN)).toBeInTheDocument(); // 正文=原文（展开渲染让一拍）
    expect(translateTextMock).not.toHaveBeenCalled();
  });

  it("流结束：折叠摘要自动换中文译文", async () => {
    translateTextMock.mockImplementation(
      (input: string) => Promise.resolve(`${ZH}（前缀：${input.slice(0, 6)}…）`),
    );
    render(<ThinkingRowView segment={makeSegment()} />);
    await waitFor(() => expect(screen.getByText(/^智能体检查了仓库结构/)).toBeInTheDocument());
    expect(translateTextMock).toHaveBeenCalledTimes(1); // 摘要前缀单次请求
  });

  it("展开：正文默认译文，「显示原文」本地切换往返", async () => {
    translateTextMock.mockResolvedValue(ZH);
    render(<ThinkingRowView segment={makeSegment()} />);
    await waitFor(() => expect(screen.getByText(/^智能体检查了仓库结构/)).toBeInTheDocument());
    expandRow();
    await screen.findByText(ZH);
    fireEvent.click(screen.getByRole("button", { name: "显示原文" }));
    expect(screen.getByText(EN)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示译文" }));
    expect(screen.getByText(ZH)).toBeInTheDocument();
  });

  it("偏好关闭：摘要与正文均原文零请求", () => {
    act(() => useThinkingTranslateStore.getState().setEnabled(false));
    translateTextMock.mockResolvedValue(ZH);
    render(<ThinkingRowView segment={makeSegment()} />);
    expect(screen.getByText(/The agent examines/)).toBeInTheDocument();
    expandRow();
    expect(screen.getByText(EN)).toBeInTheDocument();
    expect(translateTextMock).not.toHaveBeenCalled();
  });
});
