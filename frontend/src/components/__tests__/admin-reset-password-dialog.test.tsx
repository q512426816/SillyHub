/**
 * ql-20260902-006-7965：AdminResetPasswordDialog 单测。
 *
 * 依据:
 *   - backend/app/modules/admin/users_service.py reset_password（不填 new_password
 *     时随机生成一次性口令，经响应 plaintext_password 下发）
 *   - backend/app/core/security.py assert_password_strength（≥8 位 + 字母数字同存）
 *   - backend/app/core/errors.py validation_error 处理器（details.errors[0].msg）
 *   - frontend/src/components/admin-reset-password-dialog.tsx
 *
 * 覆盖:
 *   1. validateResetPassword 纯函数：过短 / 纯字母 / 纯数字 / 合法
 *   2. 默认路径提交 → onReset(undefined)，成功后展示一次性密码且不关弹窗
 *   3. 一次性密码面板点「我已保存，关闭」→ onClose
 *   4. 自定义合法密码 → onReset 携明文，成功后直接关弹窗
 *   5. 自定义纯字母 ≥8 位 → 行内提示 + 提交禁用
 *   6. 自定义 <8 位 → 行内提示 + 提交禁用
 *   7. 422 validation_error → 剥 "Value error, " 前缀透传具体原因
 *   8. 非 ApiError 拒绝 → 兜底「重置失败」
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminResetPasswordDialog,
  extractResetPasswordError,
  validateResetPassword,
} from "@/components/admin-reset-password-dialog";
import { ApiError } from "@/lib/api";
import type { UserRead } from "@/lib/admin";

const user = {
  id: "u1",
  username: "alice",
  email: "alice@example.com",
  display_name: null,
  status: "active",
  is_platform_admin: false,
  login_enabled: true,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00Z",
  organizations: [],
  roles: [],
} satisfies UserRead;

type DialogOverrides = Partial<ComponentProps<typeof AdminResetPasswordDialog>>;

function renderDialog(overrides: DialogOverrides = {}) {
  return render(
    <AdminResetPasswordDialog
      user={user}
      onReset={
        overrides.onReset ?? vi.fn().mockResolvedValue({ plaintext_password: "Sh-abc123-1a" })
      }
      onClose={overrides.onClose ?? vi.fn()}
    />,
  );
}

function checkCustom() {
  fireEvent.click(screen.getByRole("checkbox", { name: "自定义密码" }));
}

function typeCustom(value: string) {
  fireEvent.change(screen.getByLabelText("新密码"), {
    target: { value },
  });
}

afterEach(cleanup);

describe("validateResetPassword 纯函数", () => {
  it.each([
    ["short1", "密码至少 8 位"],
    ["abcdefgh", "密码必须同时包含字母和数字"],
    ["12345678", "密码必须同时包含字母和数字"],
  ])("%s → %s", (input, expected) => {
    expect(validateResetPassword(input)).toBe(expected);
  });

  it("abcd1234 → 通过（null）", () => {
    expect(validateResetPassword("abcd1234")).toBeNull();
  });
});

describe("AdminResetPasswordDialog", () => {
  it("默认路径提交：onReset 收到 undefined，成功后展示一次性密码且不关弹窗", async () => {
    const onReset = vi.fn().mockResolvedValue({ plaintext_password: "Sh-xyz789-1a" });
    const onClose = vi.fn();
    renderDialog({ onReset, onClose });

    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));

    await screen.findByText("Sh-xyz789-1a");
    expect(onReset).toHaveBeenCalledWith(undefined);
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByText(/一次性密码如下，仅显示一次/),
    ).toBeInTheDocument();
  });

  it("一次性密码面板点「我已保存，关闭」→ onClose", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
    await screen.findByText("Sh-abc123-1a");

    fireEvent.click(screen.getByRole("button", { name: "我已保存，关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("自定义合法密码：onReset 携明文，成功后直接关弹窗", async () => {
    const onReset = vi.fn().mockResolvedValue({ plaintext_password: "irrelevant1" });
    const onClose = vi.fn();
    renderDialog({ onReset, onClose });

    checkCustom();
    typeCustom("abcd1234");
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onReset).toHaveBeenCalledWith("abcd1234");
  });

  it("自定义纯字母 ≥8 位：行内提示且提交禁用", () => {
    renderDialog();

    checkCustom();
    typeCustom("abcdefgh");

    expect(screen.getByText("密码必须同时包含字母和数字")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认重置" })).toBeDisabled();
  });

  it("自定义 <8 位：行内提示且提交禁用", () => {
    renderDialog();

    checkCustom();
    typeCustom("ab1");

    expect(screen.getByText("密码至少 8 位")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认重置" })).toBeDisabled();
  });

  it("422 validation_error：剥前缀透传后端具体原因", async () => {
    const onReset = vi.fn().mockRejectedValue(
      new ApiError(422, {
        code: "validation_error",
        message: "请求参数校验失败，请检查输入格式。",
        request_id: "r1",
        details: {
          errors: [{ type: "value_error", msg: "Value error, 密码过于简单：命中常见弱口令黑名单，请更换。" }],
        },
      }),
    );
    renderDialog({ onReset });

    checkCustom();
    typeCustom("admin123"); // 长度/字母数字都过，但命中后端黑名单
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));

    await screen.findByText("密码过于简单：命中常见弱口令黑名单，请更换。");
  });

  it("非 ApiError 拒绝：兜底「重置失败」", async () => {
    const onReset = vi.fn().mockRejectedValue(new Error("boom"));
    renderDialog({ onReset });

    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));

    await screen.findByText("重置失败");
  });
});

describe("extractResetPasswordError 纯函数", () => {
  it("非 ApiError → 兜底文案", () => {
    expect(extractResetPasswordError(new Error("x"))).toBe("重置失败");
  });

  it("ApiError 非 validation_error → 用 message", () => {
    expect(
      extractResetPasswordError(
        new ApiError(403, {
          code: "PERMISSION_DENIED",
          message: "仅平台管理员可重置平台管理员的密码。",
          request_id: null,
          details: null,
        }),
      ),
    ).toBe("仅平台管理员可重置平台管理员的密码。");
  });

  it("validation_error 但 msg 非字符串 → 回退 message", () => {
    expect(
      extractResetPasswordError(
        new ApiError(422, {
          code: "validation_error",
          message: "请求参数校验失败，请检查输入格式。",
          request_id: null,
          details: { errors: [{ msg: 42 }] },
        }),
      ),
    ).toBe("请求参数校验失败，请检查输入格式。");
  });
});
