import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({
  changePassword: vi.fn(),
  // task-07（2026-09-10-account-avatar-upload）：个人资料卡片头像写回。
  updateMyAvatar: vi.fn(),
}));

// GroupMemberAvatarUpload 上传管线 mock（对齐 member-panel.test 惯例）：
// uploadFile 供选图断言、getFileDownloadUrl 保持 /api/file/{id} 形态、
// fetchFileBlob 供头像渲染链路（useAvatarSrc）静默回 Blob。
vi.mock("@/lib/file/api", () => ({
  uploadFile: vi.fn(),
  getFileDownloadUrl: (id: string) => `/api/file/${id}`,
  fetchFileBlob: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
  // ql-20260911-019-1f01：删除 + 孤儿回收（与真实实现同语义——/api/file/{36}
  // 形态才触发，fire-and-forget 吞错）。
  deleteFile: vi.fn(async () => {}),
  tryReclaimOrphanAvatarFile: (url: string | null | undefined): boolean => {
    if (!url || !url.startsWith("/api/file/")) return false;
    const id = url.slice("/api/file/".length);
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return false;
    void (globalThis as { __reclaimMockDeleter?: (id: string) => void })
      .__reclaimMockDeleter?.(id);
    return true;
  },
}));

import { changePassword, updateMyAvatar } from "@/lib/auth";
import { deleteFile, uploadFile } from "@/lib/file/api";
import { useSession } from "@/stores/session";
import AccountPage from "@/app/(dashboard)/account/page";

const mockedChangePassword = vi.mocked(changePassword);
const mockedUpdateMyAvatar = vi.mocked(updateMyAvatar);
const mockedUploadFile = vi.mocked(uploadFile);
const mockedDeleteFile = vi.mocked(deleteFile);
// mock 版 tryReclaimOrphanAvatarFile 的删除落点（绕开模块内闭包，可断言）。
(globalThis as { __reclaimMockDeleter?: (id: string) => void }).__reclaimMockDeleter = (
  id: string,
) => {
  void mockedDeleteFile(id);
};

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
    // 个人资料卡片 describe 会注入 user——这里显式还原，隔离两个 describe。
    useSession.setState({ user: null });
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
    const submitBtn = screen.getByRole("button", { name: "修改密码" }) as HTMLButtonElement;
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
    const submitBtn = screen.getByRole("button", { name: "修改密码" }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    expect(
      screen.getByText("两次输入的新密码不一致"),
    ).toBeInTheDocument();
  });

  it("合法输入 + 提交 → 调 changePassword 且参数正确", async () => {
    mockedChangePassword.mockResolvedValue(undefined);
    render(<AccountPage />);
    fillValidForm();
    const submitBtn = screen.getByRole("button", { name: "修改密码" }) as HTMLButtonElement;
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
    const submitBtn = screen.getByRole("button", { name: "修改密码" }) as HTMLButtonElement;
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
    fireEvent.click(submitBtn);
    await waitFor(() => expect(mockedChangePassword).toHaveBeenCalled());
    expect(await screen.findByText("旧密码错误")).toBeInTheDocument();
  });

  it("空表单时提交禁用", () => {
    render(<AccountPage />);
    const submitBtn = screen.getByRole("button", { name: "修改密码" }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });
});

describe("AccountPage 个人资料卡片（头像上传，task-07）", () => {
  const baseUser = {
    id: "u-1",
    email: "user@example.com",
    displayName: "测试用户",
  };

  beforeEach(() => {
    useSession.setState({ user: { ...baseUser } });
    mockedUpdateMyAvatar.mockReset();
    mockedUpdateMyAvatar.mockResolvedValue(undefined);
    mockedUploadFile.mockReset();
  });

  it("个人资料卡片渲染于修改密码卡片上方；未设头像预览为首字回退", () => {
    render(<AccountPage />);
    // 文档顺序：个人资料小节标题在 修改密码小节标题之前（selector h3 避开
    // 同名提交按钮；compareDocumentPosition 返回 FOLLOWING 位 = 后者在后）。
    const profile = screen.getByText("个人资料", { selector: "h3" });
    const password = screen.getByText("修改密码", { selector: "h3" });
    expect(
      profile.compareDocumentPosition(password) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // GroupMemberAvatar 首字回退（displayName 首字），无头像图。
    expect(
      screen.getByTestId("group-member-avatar-initial"),
    ).toHaveTextContent("测");
    expect(
      screen.queryByTestId("group-member-avatar-img"),
    ).not.toBeInTheDocument();
  });

  it("上传成功 → owner_type=user_avatar 且 updateMyAvatar 收到 getFileDownloadUrl(id)", async () => {
    render(<AccountPage />);
    mockedUploadFile.mockResolvedValue({
      id: "file-av-1",
      original_name: "a.png",
      mime_type: "image/png",
      size: 10,
    });
    fireEvent.change(screen.getByLabelText("我的头像（选择图片）"), {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mockedUpdateMyAvatar).toHaveBeenCalledTimes(1));
    expect(mockedUploadFile).toHaveBeenCalledWith(expect.any(File), {
      owner_type: "user_avatar",
    });
    expect(mockedUpdateMyAvatar).toHaveBeenCalledWith("/api/file/file-av-1");
  });

  it("有自定义头像时恢复默认 → updateMyAvatar(null)", async () => {
    useSession.setState({
      user: { ...baseUser, avatar: "/api/file/file-old" },
    });
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    await waitFor(() =>
      expect(mockedUpdateMyAvatar).toHaveBeenCalledWith(null),
    );
  });

  it("updateMyAvatar 失败 → 页内错误提示可见（对齐修改密码 globalError 风格）", async () => {
    render(<AccountPage />);
    mockedUploadFile.mockResolvedValue({
      id: "file-av-2",
      original_name: "b.png",
      mime_type: "image/png",
      size: 10,
    });
    mockedUpdateMyAvatar.mockRejectedValue(new Error("头像保存失败"));
    fireEvent.change(screen.getByLabelText("我的头像（选择图片）"), {
      target: { files: [new File(["x"], "b.png", { type: "image/png" })] },
    });
    expect(await screen.findByText("头像保存失败")).toBeInTheDocument();
  });

  it("上传成功但保存失败 → 新文件 best-effort 回收（deleteFile 收到新 id，ql-20260911-019-1f01）", async () => {
    render(<AccountPage />);
    mockedUploadFile.mockResolvedValue({
      id: "0e2b4d8e-1111-4222-8333-444455556666",
      original_name: "c.png",
      mime_type: "image/png",
      size: 10,
    });
    mockedUpdateMyAvatar.mockRejectedValue(new Error("头像保存失败"));
    fireEvent.change(screen.getByLabelText("我的头像（选择图片）"), {
      target: { files: [new File(["x"], "c.png", { type: "image/png" })] },
    });
    expect(await screen.findByText("头像保存失败")).toBeInTheDocument();
    // 上传的文件即刻回收；恢复默认（avatar=null）失败路径不触发删除
    await waitFor(() =>
      expect(mockedDeleteFile).toHaveBeenCalledWith(
        "0e2b4d8e-1111-4222-8333-444455556666",
      ),
    );
    mockedDeleteFile.mockClear();
    // 恢复默认按钮仅在有自定义头像时渲染——置 store 头像后再触发
    useSession.setState({
      user: { ...baseUser, avatar: "/api/file/0e2b4d8e-1111-4222-8333-444455556666" },
    });
    const resetBtn = await screen.findByRole("button", { name: "恢复默认" });
    fireEvent.click(resetBtn);
    await waitFor(() =>
      expect(mockedUpdateMyAvatar).toHaveBeenLastCalledWith(null),
    );
    expect(mockedDeleteFile).not.toHaveBeenCalled();
  });
});
