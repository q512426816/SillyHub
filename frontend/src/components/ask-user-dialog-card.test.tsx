/**
 * AskUserQuestion 对话卡片测试。
 *
 * 覆盖：
 *   - 单选/多选渲染 + 选项点击切换；
 *   - 自定义选项选中后展示文本输入框，提交时用 customText 作答；
 *   - 提交按钮 disabled 条件（全部问题已作答才可提交）；
 *   - 提交后调 respondSessionPermission with dialog_result；
 *   - dialog_payload 缺失/格式不符 → 兜底提示不崩溃。
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskUserDialogCard } from "@/components/ask-user-dialog-card";
import type { SessionPermissionRequest } from "@/lib/daemon";

// mock api 模块的 fetch 链路（拦截 useSession.getState + global fetch）
vi.mock("@/stores/session", () => ({
  useSession: {
    getState: () => ({ accessToken: "test-token" }),
  },
}));

function makeDialogRequest(
  payload: Record<string, unknown>,
  overrides: Partial<SessionPermissionRequest> = {},
): SessionPermissionRequest {
  return {
    session_id: "sess-1",
    run_id: "run-1",
    request_id: "req-1",
    tool_name: "AskUserQuestion",
    input: {},
    dialog_kind: "ask_user",
    dialog_payload: payload,
    ...overrides,
  };
}

const SINGLE_QUESTION_PAYLOAD = {
  questions: [
    {
      question: "运行时目录设置在哪里？",
      header: "运行时目录",
      multiSelect: false,
      options: [
        {
          label: "使用项目本地目录",
          description: "在项目目录内创建",
          preview: "--runtime-root /path/local",
        },
        {
          label: "使用用户临时目录",
          description: "在系统临时目录中创建",
          preview: "--runtime-root /tmp/x",
        },
        {
          label: "使用其他自定义路径",
          description: "你自己提供一个可写的绝对路径",
          preview: "请在 Other 中输入完整路径",
        },
      ],
    },
  ],
};

const MULTI_QUESTION_PAYLOAD = {
  questions: [
    {
      question: "选择要启用的功能（可多选）",
      multiSelect: true,
      options: [
        { label: "自动同步" },
        { label: "自动导入" },
        { label: "其他自定义功能", preview: "请输入" },
      ],
    },
  ],
};

describe("AskUserDialogCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("渲染问题文本、header 标签和所有选项", () => {
    render(
      <AskUserDialogCard request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)} />,
    );
    expect(screen.getByText("运行时目录设置在哪里？")).toBeInTheDocument();
    expect(screen.getByText("运行时目录")).toBeInTheDocument();
    expect(screen.getByText("使用项目本地目录")).toBeInTheDocument();
    expect(screen.getByText("使用用户临时目录")).toBeInTheDocument();
    expect(screen.getByText("使用其他自定义路径")).toBeInTheDocument();
    expect(screen.queryByText("（可多选）")).not.toBeInTheDocument();
  });

  it("多选问题渲染（可多选）标记", () => {
    render(
      <AskUserDialogCard request={makeDialogRequest(MULTI_QUESTION_PAYLOAD)} />,
    );
    expect(screen.getByText("（可多选）")).toBeInTheDocument();
  });

  it("单选：点击选项切换选中状态，提交按钮启用", () => {
    render(
      <AskUserDialogCard request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)} />,
    );
    const submitBtn = screen.getByRole("button", { name: /提交回答/ });
    expect(submitBtn).toBeDisabled();

    fireEvent.click(screen.getByText("使用项目本地目录"));
    expect(submitBtn).not.toBeDisabled();
  });

  it("单选：点击同一选项可取消选择", () => {
    render(
      <AskUserDialogCard request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)} />,
    );
    const option = screen.getByText("使用项目本地目录");
    fireEvent.click(option);
    fireEvent.click(option);
    // 取消后提交按钮应再次禁用
    expect(
      screen.getByRole("button", { name: /提交回答/ }),
    ).toBeDisabled();
  });

  it("多选：可选中多个选项", () => {
    render(
      <AskUserDialogCard request={makeDialogRequest(MULTI_QUESTION_PAYLOAD)} />,
    );
    fireEvent.click(screen.getByText("自动同步"));
    fireEvent.click(screen.getByText("自动导入"));
    expect(
      screen.getByRole("button", { name: /提交回答/ }),
    ).not.toBeDisabled();
  });

  it("ql-013 常驻手动输入框始终显示（无需选中选项）", () => {
    render(
      <AskUserDialogCard request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)} />,
    );
    expect(
      screen.getByPlaceholderText("或手动输入（填写后以此内容作答）"),
    ).toBeInTheDocument();
  });

  it("ql-013 只填手动输入框（不选选项）即可启用提交", () => {
    render(
      <AskUserDialogCard request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)} />,
    );
    const submitBtn = screen.getByRole("button", { name: /提交回答/ });
    expect(submitBtn).toBeDisabled();
    fireEvent.change(
      screen.getByPlaceholderText("或手动输入（填写后以此内容作答）"),
      { target: { value: "MyProject" } },
    );
    expect(submitBtn).not.toBeDisabled();
  });

  it("提交普通选项时调 respondSessionPermission with dialog_result.answers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );

    const onResolved = vi.fn();
    render(
      <AskUserDialogCard
        request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)}
        onResolved={onResolved}
      />,
    );

    fireEvent.click(screen.getByText("使用项目本地目录"));
    fireEvent.click(screen.getByRole("button", { name: /提交回答/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.decision).toBe("allow");
    expect(body.dialog_result).toEqual({
      answers: [
        {
          question: "运行时目录设置在哪里？",
          header: "运行时目录",
          answer: "使用项目本地目录",
        },
      ],
    });
    expect(onResolved).toHaveBeenCalledWith("req-1", "allow");
  });

  it("ql-013 填写手动输入框时 answer 用输入值（无需选选项）", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );

    render(
      <AskUserDialogCard request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)} />,
    );

    const input = screen.getByPlaceholderText("或手动输入（填写后以此内容作答）");
    fireEvent.change(input, { target: { value: "/my/custom/path" } });
    fireEvent.click(screen.getByRole("button", { name: /提交回答/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.dialog_result.answers[0].answer).toBe("/my/custom/path");
  });

  it("ql-013 手动输入覆盖已选选项（单选以输入值为准）", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );

    render(
      <AskUserDialogCard request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)} />,
    );

    // 先选预设选项，再填输入框 → 提交答案以输入框为准
    fireEvent.click(screen.getByText("使用项目本地目录"));
    fireEvent.change(
      screen.getByPlaceholderText("或手动输入（填写后以此内容作答）"),
      { target: { value: "自定义答案" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /提交回答/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.dialog_result.answers[0].answer).toBe("自定义答案");
  });

  it("多选提交时 answer 为数组", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );

    render(
      <AskUserDialogCard request={makeDialogRequest(MULTI_QUESTION_PAYLOAD)} />,
    );

    fireEvent.click(screen.getByText("自动同步"));
    fireEvent.click(screen.getByText("自动导入"));
    fireEvent.click(screen.getByRole("button", { name: /提交回答/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.dialog_result.answers[0].answer).toEqual([
      "自动同步",
      "自动导入",
    ]);
  });

  it("提交后进入 disabled 状态", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 200 }),
    );

    render(
      <AskUserDialogCard request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)} />,
    );

    fireEvent.click(screen.getByText("使用项目本地目录"));
    const submitBtn = screen.getByRole("button", { name: /提交回答/ });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // 提交后按钮文案变为"提交中"，且选项不可再点
      expect(
        screen.getByRole("button", { name: /提交中|已提交/ }),
      ).toBeInTheDocument();
    });
  });

  it("提交失败时显示错误且可重试", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "http_500",
          message: "daemon 离线",
          request_id: null,
          details: null,
        }),
        { status: 502 },
      ),
    );

    render(
      <AskUserDialogCard request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)} />,
    );

    fireEvent.click(screen.getByText("使用项目本地目录"));
    fireEvent.click(screen.getByRole("button", { name: /提交回答/ }));

    await waitFor(() => {
      expect(screen.getByText(/daemon 离线|提交失败/)).toBeInTheDocument();
    });
    // 按钮恢复可点击
    expect(
      screen.getByRole("button", { name: /提交回答/ }),
    ).not.toBeDisabled();
  });

  it("dialog_payload 缺失 → 渲染兜底提示不崩溃", () => {
    render(<AskUserDialogCard request={makeDialogRequest({})} />);
    expect(screen.getByText(/无法解析提问内容/)).toBeInTheDocument();
  });

  it("dialog_payload.questions 格式不符 → 渲染兜底提示", () => {
    render(
      <AskUserDialogCard
        request={makeDialogRequest({ questions: "not-an-array" })}
      />,
    );
    expect(screen.getByText(/无法解析提问内容/)).toBeInTheDocument();
  });

  it("渲染 dialog_kind badge 和 request_id 片段", () => {
    render(
      <AskUserDialogCard request={makeDialogRequest(SINGLE_QUESTION_PAYLOAD)} />,
    );
    expect(screen.getByText("ask_user")).toBeInTheDocument();
    // request_id 前 12 字符 + "…"
    expect(screen.getByText(/req-1…/)).toBeInTheDocument();
  });
});
