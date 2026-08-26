/**
 * preview-registry 单测：覆盖六类 RendererKey 匹配与边界。
 *
 * 匹配优先级（FR-03）：blob.type（后端权威 media_type 透传）> meta.mime > 扩展名兜底。
 */

import { describe, expect, it } from "vitest";

import { matchRenderer, type RendererKey } from "../preview-registry";

describe("matchRenderer", () => {
  // ---- 图片 ----
  it.each(["image/png", "image/jpeg", "image/webp", "image/gif"])(
    "image MIME %s → image",
    (mime) => {
      expect(matchRenderer(mime, "file.bin")).toBe("image" satisfies RendererKey);
    },
  );

  // ---- PDF ----
  it("application/pdf MIME → pdf", () => {
    expect(matchRenderer("application/pdf", "file.bin")).toBe("pdf");
  });

  // ---- docx ----
  it("docx MIME → docx", () => {
    expect(
      matchRenderer(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "file.bin",
      ),
    ).toBe("docx");
  });

  // ---- xlsx：ql-20260826-013 取消在线渲染 → fallback（下载引导） ----
  it("xlsx MIME → fallback（ql-20260826-013：Excel 取消在线渲染）", () => {
    expect(
      matchRenderer(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "file.bin",
      ),
    ).toBe("fallback");
  });

  // ---- markdown ----
  it("text/markdown MIME → markdown", () => {
    expect(matchRenderer("text/markdown", "file.txt")).toBe("markdown");
  });

  // ---- 扩展名兜底（mime 为空 / 未命中时） ----
  it.each([
    ["file.png", "image"],
    ["file.jpg", "image"],
    ["file.pdf", "pdf"],
    ["file.docx", "docx"],
    ["file.md", "markdown"],
    ["file.markdown", "markdown"],
  ] as const)("%s 扩展名 → %s", (filename, expected) => {
    expect(matchRenderer(null, filename)).toBe(expected);
  });

  // ---- 优先级：mime 与扩展名冲突时 mime 为准 ----
  it("mime=image/png + 扩展名 .pdf → image（mime 优先）", () => {
    expect(matchRenderer("image/png", "report.pdf")).toBe("image");
  });

  // ---- fallback ----
  it("无 mime 且无扩展名 → fallback", () => {
    expect(matchRenderer(null, "noext")).toBe("fallback");
  });

  it("无 mime 且未知扩展名 → fallback", () => {
    expect(matchRenderer(null, "file.xyz")).toBe("fallback");
  });

  it("pptx → fallback（不在本次范围，D-001）", () => {
    expect(matchRenderer(null, "slides.pptx")).toBe("fallback");
  });

  it("xls/xlsx → fallback（ql-20260826-013：Excel 取消在线渲染，下载引导）", () => {
    expect(matchRenderer("application/vnd.ms-excel", "legacy.xls")).toBe("fallback");
    expect(matchRenderer(null, "报表.xls")).toBe("fallback");
    expect(matchRenderer(null, "file.xlsx")).toBe("fallback");
  });

  it("doc → fallback（旧格式不在范围——纯前端无 Word 二进制保真渲染）", () => {
    expect(matchRenderer(null, "legacy.doc")).toBe("fallback");
  });
});
