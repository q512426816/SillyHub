// ql-20260903-012-7976：附件上传错误出口统一——超 10 个截断 toast 告知 +
// 上传失败行内红字走 errMessage（网络错误不再英文 "Failed to fetch" 直出）。
//
// 2026-10-09-pending-attachment-preview：待发 chip 点击预览——mock
// FilePreviewModal（attachment-chips.test 同款断言面）+ fetchAttachmentBlob。
//
// 渲染骨架对齐 session-input-bar-mention.test.tsx（mock @/lib/session-mention-sources
// 隔离联想数据源）；@/lib/errors 半保真——errMessage 用真实现（断言中文兜底文案），
// useNotify 换 spy（toast 断言面）。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { SessionInputBar } from "@/components/daemon/session-input-bar";

vi.mock("@/lib/session-mention-sources", () => ({
  useMentionSources: vi.fn(),
}));

// Mock FilePreviewModal（保留渲染状态供断言——attachment-chips.test 同款）。
vi.mock("@/components/files/file-preview-modal", () => ({
  FilePreviewModal: ({ open }: { open: boolean }) => (
    <div data-testid="file-preview-modal" data-open={open} />
  ),
}));

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
const uploadMock = vi.hoisted(() => vi.fn());
const fetchBlobMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { errMessage: actual.errMessage, useNotify: () => notifyMock };
});

vi.mock("@/lib/api/session-attachments", () => ({
  uploadSessionAttachment: uploadMock,
  removeSessionAttachment: vi.fn(),
  fetchAttachmentBlob: fetchBlobMock,
}));

function renderBar() {
  function Bar() {
    return (
      <SessionInputBar
        value=""
        onChange={() => {}}
        onSend={() => {}}
        disabled={false}
        placeholder="测试输入框"
        creating={false}
        workspaceId="ws-1"
      />
    );
  }
  const utils = render(<Bar />);
  const fileInput = () =>
    utils.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { ...utils, fileInput };
}

function pickFiles(input: HTMLInputElement, count: number) {
  const files = Array.from(
    { length: count },
    (_, i) => new File(["x"], `文件${i + 1}.txt`, { type: "text/plain" }),
  );
  Object.defineProperty(input, "files", { value: files });
  fireEvent.change(input);
}

describe("SessionInputBar 附件上传反馈（ql-20260903-012）", () => {
  it("一次选 12 个文件：toast 告知忽略多余的 2 个，只上传前 10 个", async () => {
    uploadMock.mockImplementation(async (_file: File, kind: string) => ({
      id: `att-${uploadMock.mock.calls.length}`,
      kind,
      media_type: "text/plain",
      bytes: 64,
      name: "文件.txt",
      created_at: "2026-09-01T00:00:00Z",
    }));
    const { fileInput } = renderBar();
    pickFiles(fileInput(), 12);

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(10));
    expect(notifyMock.warning).toHaveBeenCalledWith(
      "一次最多上传 10 个附件，已忽略多余的 2 个",
    );
  });

  it("上传失败（网络错误）→ 行内红字显示中文兜底，不出现英文 Failed to fetch", async () => {
    uploadMock.mockRejectedValue(
      new ApiError(0, {
        code: "network_error",
        message: "Failed to fetch",
        request_id: null,
        details: null,
      }),
    );
    const { fileInput } = renderBar();
    pickFiles(fileInput(), 1);

    await waitFor(() =>
      expect(screen.getByText("网络连接失败，请检查网络后重试")).toBeTruthy(),
    );
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });
});

describe("待发附件 chip 点击预览（2026-10-09-pending-attachment-preview）", () => {
  /** 上传一枚附件并等 chip 出现（返回预览按钮锚点）。 */
  async function uploadOne(name: string, kind: "image" | "file") {
    uploadMock.mockImplementation(async () => ({
      id: `att-${name}`,
      kind,
      media_type: kind === "image" ? "image/png" : "text/plain",
      bytes: 64,
      name,
      created_at: "2026-10-09T00:00:00Z",
    }));
    fetchBlobMock.mockResolvedValue(new Blob(["x"], { type: "text/plain" }));
    const { fileInput } = renderBar();
    pickFiles(fileInput(), 1);
    const title = `${name} · 1KB（点击在线预览）`;
    await waitFor(() => expect(screen.getByTitle(title)).toBeTruthy());
    return screen.getByTitle(title);
  }

  it("点击文件名区打开 FilePreviewModal 在线预览", async () => {
    const nameBtn = await uploadOne("预览图.png", "image");
    fireEvent.click(nameBtn);
    const modal = document.querySelector("[data-testid='file-preview-modal']");
    expect(modal?.getAttribute("data-open")).toBe("true");
  });

  it("点 X 删除附件不触发预览（预览/移除互不干扰）", async () => {
    await uploadOne("待删文件.txt", "file");
    fireEvent.click(screen.getByLabelText("移除附件 待删文件.txt"));
    await waitFor(() =>
      expect(screen.queryByTitle("待删文件.txt · 1KB（点击在线预览）")).toBeNull(),
    );
    const modal = document.querySelector("[data-testid='file-preview-modal']");
    expect(modal?.getAttribute("data-open")).toBe("false");
  });
});
