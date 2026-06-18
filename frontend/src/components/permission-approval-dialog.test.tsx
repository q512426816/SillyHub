/**
 * task-12：permission-approval-dialog（模态审批弹窗）测试。
 *
 * 复用 task-08 的 respondSessionPermission 通道与 SessionPermissionRequest 类型；
 * 本组件只是一个可访问的模态渲染层（区别于 task-08 的内联 card）。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  PermissionApprovalDialog,
  type PermissionApprovalDialogProps,
} from "@/components/permission-approval-dialog";

function baseProps(overrides: Partial<PermissionApprovalDialogProps> = {}): PermissionApprovalDialogProps {
  return {
    request: {
      sessionId: "sess-1",
      runId: "run-1",
      requestId: "req-1",
      toolName: "Write",
      input: { file_path: "/secret/x.txt", content: "..." },
    },
    submitting: false,
    error: null,
    onRespond: vi.fn(),
    onDefer: vi.fn(),
    ...overrides,
  };
}

describe("PermissionApprovalDialog", () => {
  it("does not render when request is null", () => {
    const { container } = render(
      <PermissionApprovalDialog {...baseProps({ request: null })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders tool name, structured input and accessible dialog attributes", () => {
    render(<PermissionApprovalDialog {...baseProps()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
    // tool name in title
    const heading = screen.getByRole("heading");
    expect(heading.textContent).toContain("Write");
    // structured input rendered (file_path visible)
    expect(screen.getByText(/secret\/x\.txt/)).toBeInTheDocument();
  });

  it("calls onRespond('allow') on allow click", async () => {
    const onRespond = vi.fn();
    render(<PermissionApprovalDialog {...baseProps({ onRespond })} />);
    fireEvent.click(screen.getByRole("button", { name: /允许/ }));
    expect(onRespond).toHaveBeenCalledWith("allow");
    expect(onRespond).toHaveBeenCalledTimes(1);
  });

  it("calls onRespond('deny') on deny click", async () => {
    const onRespond = vi.fn();
    render(<PermissionApprovalDialog {...baseProps({ onRespond })} />);
    fireEvent.click(screen.getByRole("button", { name: /拒绝/ }));
    expect(onRespond).toHaveBeenCalledWith("deny");
  });

  it("calls onDefer on later button", async () => {
    const onDefer = vi.fn();
    render(<PermissionApprovalDialog {...baseProps({ onDefer })} />);
    fireEvent.click(screen.getByRole("button", { name: /稍后/ }));
    expect(onDefer).toHaveBeenCalledTimes(1);
  });

  it("disables all decision buttons while submitting", () => {
    render(<PermissionApprovalDialog {...baseProps({ submitting: true })} />);
    expect(screen.getByRole("button", { name: /允许/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /拒绝/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /稍后/ })).toBeDisabled();
  });

  it("shows retryable error message and keeps request in queue", () => {
    render(
      <PermissionApprovalDialog
        {...baseProps({ error: "网络错误，请重试" })}
      />,
    );
    expect(screen.getByText(/网络错误，请重试/)).toBeInTheDocument();
    // request still rendered
    const heading = screen.getByRole("heading");
    expect(heading.textContent).toContain("Write");
  });

  it("renders without crashing on non-serializable / huge input", () => {
    const huge = { data: "x".repeat(100_000) };
    render(
      <PermissionApprovalDialog
        {...baseProps({
          request: {
            sessionId: "s",
            runId: "r",
            requestId: "q",
            toolName: "Big",
            input: huge,
          },
        })}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // not written to console.log (no spy needed; structural assertion only)
  });
});
