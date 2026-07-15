import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({
  changePassword: vi.fn(),
}));

import { changePassword } from "@/lib/auth";
import AccountPage from "@/app/(dashboard)/account/page";

const mockedChangePassword = vi.mocked(changePassword);

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("旧密码"), {
    target: { value: "oldPass123" },
  });
  fireEvent.change(screen.getByLabelText("新密码"), {
    target: { value: "newPass123" },
  });
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: "newPass123" },
  });
}

describe("AccountPage 修改密码表单", () => {
  beforeEach(() => {
    mockedChangePassword.mockReset();
  });

  it("新密码 < 8 位 → 提交禁用", () => {
    render(<AccountPage />);
    fireEvent.change(screen.getByLabelText("旧密码"), {
      target: { value: "oldPass123" },
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "short" },
    });
    const submitBtn = screen.getByRole("button") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    expect(screen.getByText("新密码至少 8 位")).toBeInTheDocument();
  });

  it("新密码 ≠ 确认密码 → 提示不匹配且提交禁用", () => {
    render(<AccountPage />);
    fireEvent.change(screen.getByLabelText("旧密码"), {
      target: { value: "oldPass123" },
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "newPass123" },
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "differentPwd" },
    });
    const submitBtn = screen.getByRole("button") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    expect(
      screen.getByText("两次输入的新密码不一致"),
    ).toBeInTheDocument();
  });

  it("合法输入 + 提交 → 调 changePassword 且参数正确", async () => {
    mockedChangePassword.mockResolvedValue(undefined);
    render(<AccountPage />);
    fillValidForm();
    const submitBtn = screen.getByRole("button") as HTMLButtonElement;
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
    fireEvent.click(submitBtn);
    await waitFor(() => expect(mockedChangePassword).toHaveBeenCalledTimes(1));
    expect(mockedChangePassword).toHaveBeenCalledWith(
      "oldPass123",
      "newPass123",
    );
    expect(
      screen.getByText("密码已修改，其他设备需重新登录"),
    ).toBeInTheDocument();
    // 成功后清空表单
    expect(
      (screen.getByLabelText("旧密码") as HTMLInputElement).value,
    ).toBe("");
  });

  it("changePassword reject（旧密码错）→ 旧密码字段展示「旧密码错误」", async () => {
    mockedChangePassword.mockRejectedValue(
      new Error("旧密码错误 (PASSWORD_INCORRECT)"),
    );
    render(<AccountPage />);
    fillValidForm();
    const submitBtn = screen.getByRole("button") as HTMLButtonElement;
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
    fireEvent.click(submitBtn);
    await waitFor(() => expect(mockedChangePassword).toHaveBeenCalled());
    expect(await screen.findByText("旧密码错误")).toBeInTheDocument();
  });

  it("空表单时提交禁用", () => {
    render(<AccountPage />);
    const submitBtn = screen.getByRole("button") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });
});
