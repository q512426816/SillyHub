/**
 * previewers-basic 冒烟测试：image / pdf / fallback 三渲染器。
 *
 * jsdom 无 createObjectURL，需 mock；antd Image 在 jsdom 下部分功能受限，仅测渲染结构。
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// jsdom Blob 缺 text()，补 polyfill（同 markdown-previewer.test.tsx 既有范式）
if (typeof Blob !== "undefined" && !Blob.prototype.text) {
  Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(this);
    });
  };
}

import {
  ImagePreviewer,
  PdfPreviewer,
  FallbackPreviewer,
  HtmlPreviewer,
} from "../previewers";

const mockBlob = new Blob(["test"], { type: "image/png" });
const mockUrl = "blob:mock";
const mockMeta = { name: "test.png", mime: "image/png", size: 1024 };

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => mockUrl),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImagePreviewer", () => {
  it("渲染 antd Image 且 alt 为文件名", () => {
    render(<ImagePreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});

describe("PdfPreviewer", () => {
  // ql-20260827-001：pdf.js 画布渲染——mock pdfjs-dist（jsdom 无 canvas/worker）。
  vi.mock("pdfjs-dist", () => {
    const makePage = () => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 595 * scale,
        height: 842 * scale,
      }),
      render: () => ({ promise: Promise.resolve() }),
    });
    return {
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: ({ url }: { url: string }) => ({
        promise: url.includes("bad")
          ? Promise.reject(new Error("invalid pdf"))
          : Promise.resolve({
              numPages: 2,
              getPage: () => Promise.resolve(makePage()),
              destroy: () => Promise.resolve(),
            }),
      }),
    };
  });

  it("顺序渲染页画布（pdf.js，容器出现页节点）", async () => {
    render(<PdfPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} />);
    const pages = await screen.findByTestId("pdf-pages");
    // 两页画布顺序追加（render promise 已 resolve）
    await vi.waitFor(() => {
      expect(pages.querySelectorAll("canvas").length).toBe(2);
    });
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
  });

  it("解析失败显示错误引导", async () => {
    render(<PdfPreviewer blob={mockBlob} url="blob:bad" meta={mockMeta} />);
    expect(await screen.findByText("PDF 渲染失败")).toBeInTheDocument();
  });
});

describe("FallbackPreviewer", () => {
  it("显示不支持在线预览说明与下载按钮", () => {
    const onDownload = vi.fn();
    render(
      <FallbackPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} onDownload={onDownload} />,
    );
    expect(screen.getByText("该格式暂不支持在线预览")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下载文件/ })).toBeInTheDocument();
  });

  it("点击下载按钮触发 onDownload", () => {
    const onDownload = vi.fn();
    render(
      <FallbackPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} onDownload={onDownload} />,
    );
    screen.getByRole("button", { name: /下载文件/ }).click();
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("显示文件大小", () => {
    render(<FallbackPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} />);
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
  });
});

describe("HtmlPreviewer（2026-08-26-file-fullscreen-preview）", () => {
  const htmlBlob = new Blob(["<h1>原型标题</h1>"], { type: "text/html" });
  const htmlMeta = { name: "proto.html", mime: "text/html", size: 20 };

  it("读取期间先渲染 loading 态（iframe 未挂载）", () => {
    render(<HtmlPreviewer blob={htmlBlob} url={mockUrl} meta={htmlMeta} />);
    expect(screen.getByText(/正在读取 HTML/)).toBeInTheDocument();
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
  });

  it("blob 文本读出后经 iframe srcDoc 渲染，sandbox 不含 allow-same-origin", async () => {
    const { container } = render(
      <HtmlPreviewer blob={htmlBlob} url={mockUrl} meta={htmlMeta} />,
    );
    const iframe = await waitFor(() => {
      const el = document.querySelector("iframe");
      expect(el).toBeInTheDocument();
      return el as HTMLIFrameElement;
    });
    expect(iframe.getAttribute("srcdoc")).toBe("<h1>原型标题</h1>");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-popups");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.title).toBe("proto.html 渲染预览");
    // fill 缺省：固定视口高（与 PdfPreviewer 非 fill 行为一致）
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-[70vh]");
  });
});

describe("fill 透传（2026-08-26-file-fullscreen-preview）", () => {
  it("PdfPreviewer fill=true：根容器 h-full 替代 h-[70vh]", () => {
    const { container } = render(
      <PdfPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} fill />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-full");
    expect(root.className).not.toContain("h-[70vh]");
  });

  it("PdfPreviewer fill 缺省：维持 h-[70vh] 不含 h-full（零回归）", () => {
    const { container } = render(
      <PdfPreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-[70vh]");
    expect(root.className).not.toContain("h-full");
  });

  it("ImagePreviewer fill=true：容器 h-full、img max-h-full", () => {
    const { container } = render(
      <ImagePreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} fill />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-full");
    const img = container.querySelector("img");
    expect(img?.className).toContain("max-h-full");
    expect(img?.className).not.toContain("max-h-[560px]");
  });

  it("ImagePreviewer fill 缺省：img 维持 max-h-[560px] 不含 max-h-full（零回归）", () => {
    const { container } = render(
      <ImagePreviewer blob={mockBlob} url={mockUrl} meta={mockMeta} />,
    );
    const img = container.querySelector("img");
    expect(img?.className).toContain("max-h-[560px]");
    expect(img?.className).not.toContain("max-h-full");
  });

  it("HtmlPreviewer fill=true：根容器 h-full", async () => {
    const { container } = render(
      <HtmlPreviewer
        blob={new Blob(["<p>x</p>"], { type: "text/html" })}
        url={mockUrl}
        meta={{ name: "a.html", mime: "text/html", size: 1 }}
        fill
      />,
    );
    await waitFor(() => {
      expect(document.querySelector("iframe")).toBeInTheDocument();
    });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-full");
    expect(root.className).not.toContain("h-[70vh]");
  });
});
