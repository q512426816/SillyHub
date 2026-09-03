// ql-20260903-012-7976：附件上传错误出口统一——超 10 个截断 toast 告知 +
// 上传失败行内红字走 errMessage（网络错误不再英文 "Failed to fetch" 直出）。
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

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
const uploadMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { errMessage: actual.errMessage, useNotify: () => notifyMock };
});

vi.mock("@/lib/api/session-attachments", () => ({
  uploadSessionAttachment: uploadMock,
  removeSessionAttachment: vi.fn(),
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
