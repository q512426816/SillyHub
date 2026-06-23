/**
 * ql-20260623-003-7c2e：退出登录二次确认弹窗测试。
 *
 * 基于 ui/dialog（radix），open 受控：open=false 不渲染内容；
 * 点「确认退出」触发 onConfirm，点「取消」触发 onOpenChange(false)。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LogoutConfirmDialog } from "@/components/logout-confirm-dialog";

describe("LogoutConfirmDialog", () => {
  it("open=false 时不渲染弹窗内容", () => {
    render(
      <LogoutConfirmDialog
        open={false}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText("确认退出登录？")).toBeNull();
  });

  it("open=true 时渲染标题、描述与操作按钮", () => {
    render(
      <LogoutConfirmDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText("确认退出登录？")).toBeInTheDocument();
    expect(screen.getByText(/退出后需要重新登录/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /确认退出/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /取消/ })).toBeInTheDocument();
  });

  it("点「确认退出」调用 onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <LogoutConfirmDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /确认退出/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("点「取消」调用 onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(
      <LogoutConfirmDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
