/**
 * 2026-11-04-steered-msg-attachment-chips：引导消息段（mid-turn steer）附件展示。
 *
 * 背景：上游数据链路本来就带 `[附件:<uuid>|<kind>|<name>]` 标记行（后端 inject 留痕
 * + 前端引导发送拼展示文本 + 历史回放 withMarker 版本），但 UserMsgSegmentView
 * 只取剥离后的正文、丢弃 attachments，导致引导气泡上看不到附件卡片。
 *
 * 覆盖：
 *   FR-01 三态（steering / delivered / ended）均渲染附件 chips；
 *   FR-02 图片缩略图 + 文件 chip，点击打开预览；
 *   FR-03 正文剥离标记行；纯附件（正文空）不渲染空正文节点。
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserMsgSegmentView } from "../turn-segment-views";
import type { TurnSegment } from "../session-log-assembler";

// Mock 预览窗（保留 open 状态供断言）；沿用 attachment-chips.test.tsx 同款桩。
vi.mock("@/components/files/file-preview-modal", () => ({
  FilePreviewModal: ({ open }: { open: boolean }) => (
    <div data-testid="file-preview-modal" data-open={open} />
  ),
}));

// Mock 附件内容接口（chips 缩略图 / 预览拉取）。
vi.mock("@/lib/api/session-attachments", () => ({
  fetchAttachmentObjectUrl: vi.fn(() => Promise.resolve("blob:mock")),
  fetchAttachmentBlob: vi.fn(() => Promise.resolve(new Blob(["test"]))),
}));

const UUID_IMG = "11111111-1111-1111-1111-111111111111";
const UUID_FILE = "22222222-2222-2222-2222-222222222222";

const MARKED = [
  `[附件:${UUID_IMG}|image|截图.png]`,
  `[附件:${UUID_FILE}|file|报告.pdf]`,
  "",
  "请看这份识别结果",
].join("\n");

type UserMsgSegment = Extract<TurnSegment, { kind: "user_msg" }>;

function makeSegment(phase: UserMsgSegment["phase"], text: string): UserMsgSegment {
  return { kind: "user_msg", id: "seg-user-1", text, ts: 1000, phase };
}

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
});

describe("UserMsgSegmentView 附件展示（2026-11-04-steered-msg-attachment-chips）", () => {
  it.each(["steering", "delivered", "ended"] as const)(
    "三态均渲染附件 chips（phase=%s）",
    async (phase) => {
      render(<UserMsgSegmentView segment={makeSegment(phase, MARKED)} />);
      // 文件 chip 文本 + 图片缩略图 alt 均在场。
      expect(screen.getByText("报告.pdf")).toBeInTheDocument();
      expect(await screen.findByAltText("截图.png")).toBeInTheDocument();
    },
  );

  it("点击引导气泡内文件 chip 打开预览", () => {
    render(<UserMsgSegmentView segment={makeSegment("delivered", MARKED)} />);
    const chip = screen.getByText("报告.pdf").closest("button");
    expect(chip).toBeInTheDocument();
    act(() => {
      chip?.click();
    });
    const modal = document.querySelector("[data-testid='file-preview-modal']");
    expect(modal?.getAttribute("data-open")).toBe("true");
  });

  it("正文剥离标记行，不显示原始 [附件: 文本", () => {
    const { container } = render(
      <UserMsgSegmentView segment={makeSegment("delivered", MARKED)} />,
    );
    expect(screen.getByText("请看这份识别结果")).toBeInTheDocument();
    expect(container.textContent).not.toContain("[附件:");
  });

  it("纯附件引导消息：只渲染 chips 与状态行，不渲染空正文节点", async () => {
    const onlyMarkers = [`[附件:${UUID_FILE}|file|报告.pdf]`].join("\n");
    const { container } = render(
      <UserMsgSegmentView segment={makeSegment("delivered", onlyMarkers)} />,
    );
    expect(screen.getByText("报告.pdf")).toBeInTheDocument();
    expect(screen.getByText("✓ 已投递，agent 已收到引导")).toBeInTheDocument();
    expect(container.querySelector("[data-steered-body]")).toBeNull();
  });
});
