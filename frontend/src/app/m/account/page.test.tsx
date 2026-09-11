import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// next/navigation mock：页面 useRouter（退出登录 replace / 工作区设置 push）。
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));

vi.mock("@/lib/auth", () => ({
  logout: vi.fn(),
  changePassword: vi.fn(),
  // task-08（2026-09-10-account-avatar-upload）：头像写回。
  updateMyAvatar: vi.fn(),
}));

// 头像上传管线 mock（对齐桌面 (dashboard)/account/page.test 惯例）：
// uploadFile 供选图断言、getFileDownloadUrl 保持 /api/file/{id} 形态、
// fetchFileBlob 供头像渲染链路（useAvatarSrc）静默回 Blob；
// tryReclaimOrphanAvatarFile 供上传失败 catch 路径兜底回收（ql-20260911-019-1f01
// 新增调用，缺导出会让异步 handler 抛未捕获错误——用例全过后仍打挂 vitest 进程）。
vi.mock("@/lib/file/api", () => ({
  uploadFile: vi.fn(),
  getFileDownloadUrl: (id: string) => `/api/file/${id}`,
  fetchFileBlob: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
  tryReclaimOrphanAvatarFile: vi.fn(() => false),
}));

import { changePassword, logout, updateMyAvatar } from "@/lib/auth";
import { uploadFile } from "@/lib/file/api";
import { useSession } from "@/stores/session";
import MobileAccountPage from "@/app/m/account/page";

const mockedChangePassword = vi.mocked(changePassword);
const mockedLogout = vi.mocked(logout);
const mockedUpdateMyAvatar = vi.mocked(updateMyAvatar);
const mockedUploadFile = vi.mocked(uploadFile);

const baseUser = {
  id: "u-1",
  email: "user@example.com",
  displayName: "测试用户",
};

describe("MobileAccountPage 头像上传（task-08）", () => {
  beforeEach(() => {
    nav.push.mockClear();
    nav.replace.mockClear();
    mockedChangePassword.mockReset();
    mockedLogout.mockReset();
    mockedUpdateMyAvatar.mockReset();
    mockedUpdateMyAvatar.mockResolvedValue(undefined);
    mockedUploadFile.mockReset();
    useSession.setState({ user: { ...baseUser } });
  });

  it("无自定义头像 → 首字回退，无头像图且无恢复默认入口", () => {
    render(<MobileAccountPage />);
    const avatarBtn = screen.getByRole("button", { name: "更换头像" });
    expect(avatarBtn).toHaveTextContent("测");
    expect(
      screen.queryByAltText(`${baseUser.displayName}的头像`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "恢复默认头像" }),
    ).not.toBeInTheDocument();
  });

  it("选图上传成功 → owner_type=user_avatar 且 updateMyAvatar 收到 /api/file/{id}", async () => {
    mockedUploadFile.mockResolvedValue({
      id: "file-m-1",
      original_name: "a.png",
      mime_type: "image/png",
      size: 10,
    });
    render(<MobileAccountPage />);
    fireEvent.change(screen.getByLabelText("我的头像（选择图片）"), {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(mockedUpdateMyAvatar).toHaveBeenCalledTimes(1));
    expect(mockedUploadFile).toHaveBeenCalledWith(expect.any(File), {
      owner_type: "user_avatar",
    });
    expect(mockedUpdateMyAvatar).toHaveBeenCalledWith("/api/file/file-m-1");
  });

  it("有自定义头像时恢复默认 → updateMyAvatar(null)", async () => {
    useSession.setState({
      user: { ...baseUser, avatar: "/api/file/file-old" },
    });
    render(<MobileAccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认头像" }));
    await waitFor(() =>
      expect(mockedUpdateMyAvatar).toHaveBeenCalledWith(null),
    );
  });

  it("上传失败 → 页内提示可见", async () => {
    mockedUploadFile.mockRejectedValue(new Error("头像服务暂不可用"));
    render(<MobileAccountPage />);
    fireEvent.change(screen.getByLabelText("我的头像（选择图片）"), {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "头像服务暂不可用",
    );
    expect(mockedUpdateMyAvatar).not.toHaveBeenCalled();
  });

  it("非图片文件 → 提示且不发起上传", async () => {
    render(<MobileAccountPage />);
    fireEvent.change(screen.getByLabelText("我的头像（选择图片）"), {
      target: {
        files: [new File(["x"], "a.txt", { type: "text/plain" })],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "头像仅支持图片文件，请重新选择",
    );
    expect(mockedUploadFile).not.toHaveBeenCalled();
    expect(mockedUpdateMyAvatar).not.toHaveBeenCalled();
  });
});
