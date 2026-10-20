// 2026-10-19-thinking-zh-translate / FR-01：翻译渲染层（hook + 组件）单测。
//
// 覆盖维度：
//   1. hook 状态机——偏好关闭/流式中/中文内容 → off 零请求；译文到达换展示；
//      译文未就绪先显示原文（无布局跳变）；「显示原文」本地切换；
//   2. useThinkingSummary——前 500 字符送翻、译文截 60 字符；
//   3. TranslatedThinkingBody——状态行（翻译中脉冲/未就绪提示/切换按钮）与
//      markdown/plain 双形态渲染。
//
// lib/thinking-translate 全量 mock（网络与合批归 lib 自己的测试面）；偏好 store
// 直用真实 zustand store（setEnabled 切换）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

const translateTextMock = vi.fn();
const isUnavailableMock = vi.fn();
vi.mock("@/lib/thinking-translate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/thinking-translate")>();
  return {
    ...actual,
    translateText: (...args: unknown[]) => translateTextMock(...args),
    isTranslationUnavailable: () => isUnavailableMock(),
  };
});

// MarkdownText 用 next/dynamic + ssr:false——jsdom 同步渲染处于 loading(null)，
// 批量并发下动态解析慢于断言窗口造成竞态假败（agent-log-viewer.test.tsx 同款
// 先例注释）。本文件测翻译状态机与切换交互，不测 markdown 渲染本身（库保证），
// mock 成纯文本渲染消除竞态。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

import {
  TranslatedThinkingBody,
  useThinkingSummary,
  useThinkingTranslation,
} from "@/components/thinking-translate";
import { useThinkingTranslateStore } from "@/stores/thinking-translate";

const EN = "The agent reads the file and decides what to do next in this long thinking.";
const ZH = "这段思考内容大部分是中文，不需要翻译处理，直接展示原文即可。";

beforeEach(() => {
  translateTextMock.mockReset();
  isUnavailableMock.mockReturnValue(false);
  act(() => useThinkingTranslateStore.getState().setEnabled(true));
});

describe("useThinkingTranslation 状态机", () => {
  it("流式中 → off：显示原文且零请求", () => {
    const { result } = renderHook(() => useThinkingTranslation(EN, { streaming: true }));
    expect(result.current.state).toBe("off");
    expect(result.current.displayText).toBe(EN);
    expect(translateTextMock).not.toHaveBeenCalled();
  });

  it("偏好关闭 → off 零请求（回退原文不发请求）", () => {
    act(() => useThinkingTranslateStore.getState().setEnabled(false));
    const { result } = renderHook(() => useThinkingTranslation(EN));
    expect(result.current.state).toBe("off");
    expect(translateTextMock).not.toHaveBeenCalled();
  });

  it("中文为主 → off 零请求", () => {
    const { result } = renderHook(() => useThinkingTranslation(ZH));
    expect(result.current.state).toBe("off");
    expect(translateTextMock).not.toHaveBeenCalled();
  });

  it("翻译中先显示原文，译文到达后切换", async () => {
    let resolveFn: (v: string | null) => void = () => {};
    translateTextMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );
    const { result } = renderHook(() => useThinkingTranslation(EN));
    expect(result.current.state).toBe("translating");
    expect(result.current.displayText).toBe(EN); // 未就绪显示原文（无跳变）
    await act(async () => {
      resolveFn("智能体读取文件后决定下一步操作。");
      await Promise.resolve();
    });
    expect(result.current.state).toBe("translated");
    expect(result.current.displayText).toBe("智能体读取文件后决定下一步操作。");
  });

  it("失败 → unavailable：显示原文（lib 层退避已生效）", async () => {
    translateTextMock.mockResolvedValue(null);
    isUnavailableMock.mockReturnValue(true);
    const { result } = renderHook(() => useThinkingTranslation(EN));
    await waitFor(() => expect(result.current.state).toBe("unavailable"));
    expect(result.current.displayText).toBe(EN);
  });

  it("「显示原文」本地切换：译文⇄原文往返", async () => {
    translateTextMock.mockResolvedValue("这是中文译文内容。");
    const { result } = renderHook(() => useThinkingTranslation(EN));
    await waitFor(() => expect(result.current.state).toBe("translated"));
    act(() => result.current.toggleOriginal());
    expect(result.current.displayText).toBe(EN);
    expect(result.current.showOriginal).toBe(true);
    act(() => result.current.toggleOriginal());
    expect(result.current.displayText).toBe("这是中文译文内容。");
  });
});

describe("useThinkingSummary 摘要", () => {
  it("长英文 → 送翻前 500 字符，译文截 60 字符加省略号", async () => {
    translateTextMock.mockImplementation(
      (input: string) => Promise.resolve(`译${input.slice(0, 20)}`),
    );
    const longEn = `${EN} `.repeat(30); // ~2900 字符
    const { result } = renderHook(() => useThinkingSummary(longEn));
    await waitFor(() => expect(result.current.startsWith("译")).toBe(true));
    expect(result.current.length).toBeLessThanOrEqual(61); // 60 + 省略号
    expect((translateTextMock.mock.calls[0]![0] as string).length).toBeLessThanOrEqual(500);
  });

  it("评审 P2 回归：前缀截断吸附最近句界（不送翻半句）", async () => {
    translateTextMock.mockResolvedValue("译");
    const sentence = "A full sentence that ends with a period. ";
    const longEn = sentence.repeat(30); // 尾部回看窗内必有句界
    renderHook(() => useThinkingSummary(longEn));
    await waitFor(() => expect(translateTextMock).toHaveBeenCalled());
    const sent = translateTextMock.mock.calls[0]![0] as string;
    expect(sent.length).toBeLessThanOrEqual(500);
    // 末尾吸附在句号处（而非硬切半句；句号后空格不属吸附范围）
    expect(sent.endsWith(".")).toBe(true);
  });

  it("流式中 → 原文摘要（压平截 60）", () => {
    const { result } = renderHook(() => useThinkingSummary(`${EN} `.repeat(10), true));
    expect(result.current.startsWith("The agent reads")).toBe(true);
    expect(translateTextMock).not.toHaveBeenCalled();
  });
});

describe("TranslatedThinkingBody 组件", () => {
  it("translated：渲染译文 + 切换按钮；点击切回原文", async () => {
    translateTextMock.mockResolvedValue("组件译文展示内容。");
    render(<TranslatedThinkingBody text={EN} />);
    expect(await screen.findByText("组件译文展示内容。")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "显示原文" });
    fireEvent.click(toggle);
    expect(screen.getByText(EN)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显示译文" })).toBeInTheDocument();
  });

  it("translating：状态行显示「翻译中…」，正文显示原文", () => {
    translateTextMock.mockReturnValue(new Promise(() => {})); // 永在途
    render(<TranslatedThinkingBody text={EN} />);
    expect(screen.getByText("翻译中…")).toBeInTheDocument();
    expect(screen.getByText(EN)).toBeInTheDocument();
  });

  it("unavailable：显示「离线翻译未就绪」提示 + 原文", async () => {
    translateTextMock.mockResolvedValue(null);
    isUnavailableMock.mockReturnValue(true);
    render(<TranslatedThinkingBody text={EN} />);
    await screen.findByText("🌐 离线翻译未就绪");
    expect(screen.getByText(EN)).toBeInTheDocument();
  });

  it("plain 形态：纯文本节点渲染（AgentLogViewer 路径）", async () => {
    translateTextMock.mockResolvedValue("纯文本形态译文。");
    render(<TranslatedThinkingBody text={EN} variant="plain" />);
    await screen.findByText("纯文本形态译文。");
  });

  it("off（中文内容）：无状态行、无切换按钮", () => {
    render(<TranslatedThinkingBody text={ZH} />);
    expect(screen.getByText(ZH)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("翻译中…")).toBeNull();
  });
});
