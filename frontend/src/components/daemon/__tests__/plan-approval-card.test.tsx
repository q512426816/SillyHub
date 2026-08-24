// task-06（2026-08-24-platform-session-feedback-fix / FR-02）：PlanApprovalCard 单测。
//
// 覆盖：
//   1. 展示 objective / tasks / design_snippet；
//   2. confirm / revise / cancel 三态按钮；
//   3. revise / cancel 必须填写 feedback，confirm 无需 feedback；
//   4. 提交中按钮禁用，成功后调用 onSubmitted；
//   5. 422/404 行内错误展示。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/daemon", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    submitPlanResponse: vi.fn(),
  };
});

import { PlanApprovalCard } from "@/components/daemon/plan-approval-card";
import { submitPlanResponse } from "@/lib/daemon";
import { ApiError } from "@/lib/api";

const submitMock = vi.mocked(submitPlanResponse);

const BASE_PROPS = {
  sessionId: "sess-1",
  runId: "run-1",
  summary: {
    objective: "修复登录缺陷",
    tasks: ["复现问题", "定位根因", "补充测试"],
    design_snippet: "在 auth.service 增加空值校验",
  },
  requestedAt: "2026-08-24T10:00:00.000Z",
};

describe("PlanApprovalCard", () => {
  beforeEach(() => {
    submitMock.mockReset();
  });

  it("渲染计划摘要全部字段", () => {
    render(<PlanApprovalCard {...BASE_PROPS} />);
    expect(screen.getByText("修复登录缺陷")).toBeInTheDocument();
    expect(screen.getByText("复现问题")).toBeInTheDocument();
    expect(screen.getByText("定位根因")).toBeInTheDocument();
    expect(screen.getByText("补充测试")).toBeInTheDocument();
    expect(screen.getByText(/auth.service/)).toBeInTheDocument();
    expect(screen.getByTestId("plan-approval-card")).toBeInTheDocument();
  });

  it("默认展示 confirm / revise / cancel 三态按钮", () => {
    render(<PlanApprovalCard {...BASE_PROPS} />);
    expect(screen.getByRole("button", { name: /确认计划/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /需要修改/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^取消$/ })).toBeInTheDocument();
  });

  it("点击 confirm 不展示 feedback 输入框，可直接提交", async () => {
    submitMock.mockResolvedValueOnce();
    const onSubmitted = vi.fn();
    render(<PlanApprovalCard {...BASE_PROPS} onSubmitted={onSubmitted} />);

    fireEvent.click(screen.getByRole("button", { name: /确认计划/ }));
    expect(screen.queryByLabelText(/修改建议/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /提交决策/ }));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith("sess-1", "run-1", "confirm", undefined);
    expect(onSubmitted).toHaveBeenCalled();
  });

  it("点击 revise 显示 feedback 输入框，空反馈提交时行内报错", () => {
    render(<PlanApprovalCard {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /需要修改/ }));
    expect(screen.getByLabelText(/修改建议/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /提交决策/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("请填写修改/取消原因");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("revise 填写 feedback 后提交并回调 onSubmitted", async () => {
    submitMock.mockResolvedValueOnce();
    const onSubmitted = vi.fn();
    render(<PlanApprovalCard {...BASE_PROPS} onSubmitted={onSubmitted} />);

    fireEvent.click(screen.getByRole("button", { name: /需要修改/ }));
    fireEvent.change(screen.getByLabelText(/修改建议/), {
      target: { value: "请优先补充单元测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: /提交决策/ }));

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith(
      "sess-1",
      "run-1",
      "revise",
      "请优先补充单元测试",
    );
    expect(onSubmitted).toHaveBeenCalled();
  });

  it("cancel 填写 feedback 后提交并回调 onSubmitted", async () => {
    submitMock.mockResolvedValueOnce();
    const onSubmitted = vi.fn();
    render(<PlanApprovalCard {...BASE_PROPS} onSubmitted={onSubmitted} />);

    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));
    fireEvent.change(screen.getByLabelText(/取消原因/), {
      target: { value: "方案风险过高" },
    });
    fireEvent.click(screen.getByRole("button", { name: /提交决策/ }));

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith("sess-1", "run-1", "cancel", "方案风险过高");
    expect(onSubmitted).toHaveBeenCalled();
  });

  it("提交中禁用全部操作按钮", async () => {
    let resolveSubmit: (() => void) | undefined;
    submitMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    render(<PlanApprovalCard {...BASE_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: /确认计划/ }));
    fireEvent.click(screen.getByRole("button", { name: /提交决策/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /提交中/ })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: /确认计划/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /需要修改/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^取消$/ })).toBeDisabled();

    resolveSubmit?.();
  });

  it("ApiError 422 行内展示后端错误文案", async () => {
    submitMock.mockRejectedValueOnce(
      new ApiError(422, {
        code: "UNPROCESSABLE_ENTITY",
        message: "feedback 不能为空",
        request_id: "req-1",
        details: null,
      }),
    );
    render(<PlanApprovalCard {...BASE_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: /确认计划/ }));
    fireEvent.click(screen.getByRole("button", { name: /提交决策/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("feedback 不能为空"),
    );
  });

  it("ApiError 404 行内展示后端错误文案", async () => {
    submitMock.mockRejectedValueOnce(
      new ApiError(404, {
        code: "HTTP_404_DAEMON_SESSION_NOT_FOUND",
        message: "会话不存在",
        request_id: "req-2",
        details: null,
      }),
    );
    render(<PlanApprovalCard {...BASE_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: /确认计划/ }));
    fireEvent.click(screen.getByRole("button", { name: /提交决策/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("会话不存在"),
    );
  });
});
