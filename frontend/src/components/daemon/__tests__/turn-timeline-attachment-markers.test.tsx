/**
 * 2026-08-20-session-multimodal-attachments task-13/14：附件标记行解析单测。
 * 纯函数（parseAttachmentMarkers）——UUID 锚定 / 多标记剥离 / 非法行容错。
 */
import { describe, expect, it } from "vitest";

import { parseAttachmentMarkers } from "../runtime-session-helpers";

const UUID1 = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";

describe("parseAttachmentMarkers（task-13 D-3）", () => {
  it("头部多条标记行剥离，正文保留", () => {
    const prompt = `[附件:${UUID1}|image|截图.png]\n[附件:${UUID2}|file|日志.log]\n\n帮我看下这个报错`;
    const parsed = parseAttachmentMarkers(prompt);
    expect(parsed.attachments).toEqual([
      { id: UUID1, kind: "image", name: "截图.png" },
      { id: UUID2, kind: "file", name: "日志.log" },
    ]);
    expect(parsed.text).toBe("帮我看下这个报错");
  });

  it("纯附件无正文 → text 空串（看图说话场景）", () => {
    const parsed = parseAttachmentMarkers(`[附件:${UUID1}|image|图.png]`);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.text).toBe("");
  });

  it("非 UUID / 非标记格式行 → 按原文本容错（不误报）", () => {
    const fake = "[附件:not-a-uuid|image|x.png]\n正文";
    const parsed = parseAttachmentMarkers(fake);
    expect(parsed.attachments).toHaveLength(0);
    expect(parsed.text).toBe(fake);
  });

  it("无标记 → 原样返回（零回归）", () => {
    expect(parseAttachmentMarkers("普通追问")).toEqual({
      attachments: [],
      text: "普通追问",
    });
  });
});
