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

  /* ---- task-09（FR-09 / D-010@v1）：Codex dialog payload 复用同一卡片 ----
   * daemon（task-05）已把 Codex requestUserInput / 可归一化 MCP elicitation
   * 转成与 Claude AskUserQuestion 同构的 {questions,options}，前端不识别
   * Codex schema，零分支复用 AskUserDialogCard。响应回写仍是与 Claude 同构的
   * {answers:[{question,header?,answer}]}，Codex {answers:{[id]:{answers:string[]}}}
   * 的 schema 还原是 daemon 职责（task-05），前端不感知。 */

  it("task-09 codex_request_user_input：渲染归一化后的问题/选项/header + badge", () => {
    const codexPayload = {
      questions: [
        {
          question: "使用哪个测试框架？",
          header: "测试框架",
          multiSelect: false,
          options: [
            { label: "pytest", description: "Python 主流" },
            { label: "unittest" },
          ],
        },
      ],
    };
    render(
      <AskUserDialogCard
        request={makeDialogRequest(codexPayload, {
          dialog_kind: "codex_request_user_input",
          tool_name: "codex_request_user_input",
        })}
      />,
    );
    // badge 直接显示后端传入的 kind 字符串（专业标识，不翻译）
    expect(screen.getByText("codex_request_user_input")).toBeInTheDocument();
    expect(screen.getByText("使用哪个测试框架？")).toBeInTheDocument();
    expect(screen.getByText("测试框架")).toBeInTheDocument();
    expect(screen.getByText("pytest")).toBeInTheDocument();
    expect(screen.getByText("unittest")).toBeInTheDocument();
  });

  it("task-09 codex_request_user_input：单选作答 → 回写与 Claude 同构的 answers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );

    const codexPayload = {
      questions: [
        {
          question: "使用哪个测试框架？",
          header: "测试框架",
          options: [{ label: "pytest" }, { label: "unittest" }],
        },
      ],
    };
    render(
      <AskUserDialogCard
        request={makeDialogRequest(codexPayload, {
          request_id: "codex-req-1",
          dialog_kind: "codex_request_user_input",
        })}
      />,
    );

    fireEvent.click(screen.getByText("pytest"));
    fireEvent.click(screen.getByRole("button", { name: /提交回答/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    // 回写结构：allow + 与 Claude 同构的 dialog_result.answers
    expect(body.decision).toBe("allow");
    expect(body.dialog_result).toEqual({
      answers: [
        {
          question: "使用哪个测试框架？",
          header: "测试框架",
          answer: "pytest",
        },
      ],
    });
  });

  it("task-09 mcp_elicitation：多 question + multiSelect 作答 → answers 数组", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );

    const mcpPayload = {
      questions: [
        {
          question: "选择启用的能力",
          multiSelect: true,
          options: [{ label: "能力A" }, { label: "能力B" }, { label: "能力C" }],
        },
        {
          question: "输出格式",
          multiSelect: false,
          options: [{ label: "JSON" }, { label: "YAML" }],
        },
      ],
    };
    render(
      <AskUserDialogCard
        request={makeDialogRequest(mcpPayload, {
          request_id: "mcp-req-1",
          dialog_kind: "mcp_elicitation",
          tool_name: "mcp_server_x",
        })}
      />,
    );

    // 第一问多选两条
    fireEvent.click(screen.getByText("能力A"));
    fireEvent.click(screen.getByText("能力B"));
    // 多 question：第二问未答前提交应禁用
    expect(screen.getByRole("button", { name: /提交回答/ })).toBeDisabled();
    // 第二问单选
    fireEvent.click(screen.getByText("JSON"));
    fireEvent.click(screen.getByRole("button", { name: /提交回答/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.dialog_result.answers).toEqual([
      { question: "选择启用的能力", answer: ["能力A", "能力B"] },
      { question: "输出格式", answer: "JSON" },
    ]);
  });

  it("task-09 codex payload 缺 questions → 走兜底分支不崩溃", () => {
    render(
      <AskUserDialogCard
        request={makeDialogRequest(
          { someUnrecognizedField: true },
          { dialog_kind: "codex_request_user_input" },
        )}
      />,
    );
    expect(screen.getByText(/无法解析提问内容/)).toBeInTheDocument();
    // 兜底分支同样显示 kind badge
    expect(screen.getByText("codex_request_user_input")).toBeInTheDocument();
  });

  it("task-09 codex 某 question options 为空 → 被跳过；全空走兜底", () => {
    // 全部 question 的 options 为空 → questions.length===0 → 兜底
    render(
      <AskUserDialogCard
        request={makeDialogRequest(
          {
            questions: [
              { question: "无选项问题", options: [] },
              { question: "另一个无选项", options: [] },
            ],
          },
          { dialog_kind: "codex_request_user_input" },
        )}
      />,
    );
    expect(screen.getByText(/无法解析提问内容/)).toBeInTheDocument();
    // 不渲染半残的 question 文本
    expect(screen.queryByText("无选项问题")).not.toBeInTheDocument();
  });

  it("task-09 codex 多 question 全部作答后提交按钮才启用", () => {
    const multiQ = {
      questions: [
        { question: "问题一", options: [{ label: "A1" }, { label: "A2" }] },
        { question: "问题二", options: [{ label: "B1" }, { label: "B2" }] },
      ],
    };
    render(
      <AskUserDialogCard
        request={makeDialogRequest(multiQ, {
          dialog_kind: "codex_request_user_input",
        })}
      />,
    );
    const submit = screen.getByRole("button", { name: /提交回答/ });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByText("A1"));
    // 只答了一问，仍禁用
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByText("B2"));
    expect(submit).not.toBeDisabled();
  });
});
