// task-10: FileUpload 组件单测 (平台级文件中心, 2026-07-22)。
//
// 覆盖 (FR-6/FR-8):
//   1. 受控渲染: value 中的 id 经 fetchFileMetaBatch 回显文件名/大小
//   2. 上传成功: 调 uploadFile 透传 owner_type/owner_id, onChange 追加新 id
//   3. 上传失败: 显示错误, onChange 不变
//   4. 删除: onChange 过滤掉该 id
//   5. accept=image → Upload accept=image/*
//   6. disabled → 不渲染上传按钮
//
// 边界: mock @/lib/file/api,不真发请求;jsdom 下 antd Upload 文件选择器
// 不易驱动,经暴露的 customRequest 直接调用模拟上传。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { FileUpload } from "@/components/file-upload";
import type { FileMetaResp } from "@/lib/file/api";

vi.mock("@/lib/file/api", () => ({
  uploadFile: vi.fn(),
  fetchFileMetaBatch: vi.fn(),
  fetchFileBlob: vi.fn(() => Promise.resolve(new Blob(["x"], { type: "image/png" }))),
  getFileDownloadUrl: (id: string) => `/api/file/${id}`,
}));

import { uploadFile, fetchFileMetaBatch } from "@/lib/file/api";
const uploadFileMock = vi.mocked(uploadFile);
const fetchMetaMock = vi.mocked(fetchFileMetaBatch);

const PNG_META: FileMetaResp = {
  id: "fid-1",
  original_name: "现场照片.png",
  mime_type: "image/png",
  size: 2048,
  owner_type: "ppm_problem",
  owner_id: null,
};

function lastUploadInner(): HTMLElement {
  const ups = document.querySelectorAll(".ant-upload");
  return ups[ups.length - 1] as HTMLElement;
}

describe("FileUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMetaMock.mockResolvedValue([]);
  });

  it("受控渲染: value id 经 batch-meta 回显文件名", async () => {
    fetchMetaMock.mockResolvedValue([PNG_META]);
    render(<FileUpload value={["fid-1"]} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("现场照片.png")).toBeTruthy());
    expect(fetchMetaMock).toHaveBeenCalledWith(["fid-1"]);
  });

  it("上传成功: 调 uploadFile 透传 owner, onChange 追加新 id", async () => {
    const onChange = vi.fn();
    uploadFileMock.mockResolvedValue({
      id: "fid-new",
      original_name: "报告.pdf",
      mime_type: "application/pdf",
      size: 1024,
    });
    const { container } = render(
      <FileUpload value={[]} onChange={onChange} owner_type="ppm_problem" owner_id="p-1" />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "报告.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalled());
    const call = uploadFileMock.mock.calls[0];
    expect(call).toBeTruthy();
    const opts = call![1];
    expect(opts?.owner_type).toBe("ppm_problem");
    expect(opts?.owner_id).toBe("p-1");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["fid-new"]));
  });

  it("上传失败: 显示错误, onChange 不变", async () => {
    const onChange = vi.fn();
    uploadFileMock.mockRejectedValue(new Error("文件类型不支持"));
    const { container } = render(<FileUpload value={[]} onChange={onChange} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.exe", { type: "application/x-msdownload" })] },
    });
    await waitFor(() => expect(screen.getByText("文件类型不支持")).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("删除: onChange 过滤掉该 id", async () => {
    const onChange = vi.fn();
    fetchMetaMock.mockResolvedValue([PNG_META]);
    render(<FileUpload value={["fid-1"]} onChange={onChange} />);
    await waitFor(() => expect(screen.getByText("现场照片.png")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("删除附件"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("accept=image → Upload accept=image/*", () => {
    render(<FileUpload value={[]} onChange={() => {}} accept="image" />);
    const input = lastUploadInner().querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute("accept")).toBe("image/*");
  });

  it("disabled → 不渲染上传按钮与删除", async () => {
    fetchMetaMock.mockResolvedValue([PNG_META]);
    render(<FileUpload value={["fid-1"]} onChange={() => {}} disabled />);
    await waitFor(() => expect(screen.getByText("现场照片.png")).toBeTruthy());
    expect(screen.queryByText("上传附件")).toBeNull();
    expect(screen.queryByLabelText("删除附件")).toBeNull();
  });
});
