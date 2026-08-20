/**
 * 2026-08-20-session-multimodal-attachments task-10/14：mapUserTurnInputToSdk
 * 块数组转换。有 blocks → ContentBlockParam 数组；无 blocks → 纯字符串路径
 * 逐字等价（零回归锚点）。spike-01 的真实 SDK query 验证由 E2E 收口。
 */
import { describe, expect, it } from "vitest";

import { mapUserTurnInputToSdk } from "../../src/interactive/claude-sdk-driver.js";

async function collect(input: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of input) out.push(item);
  return out;
}

function one<T>(v: T): AsyncIterable<T> {
  return (async function* () {
    yield v;
  })();
}

describe("mapUserTurnInputToSdk attachments（task-10）", () => {
  it("无 blocks：纯字符串 content 路径逐字不变（零回归）", async () => {
    const [msg] = await collect(
      mapUserTurnInputToSdk(one({ type: "user", text: "普通追问" })),
    );
    expect(msg).toEqual({
      type: "user",
      message: { role: "user", content: "普通追问" },
      parent_tool_use_id: null,
    });
  });

  it("有 blocks：content 为块数组（text + image + document base64）", async () => {
    const [msg] = await collect(
      mapUserTurnInputToSdk(
        one({
          type: "user",
          text: "看图说话",
          blocks: [
            { type: "image", mediaType: "image/png", base64: "aW1n" },
            { type: "document", mediaType: "application/pdf", base64: "cGRm" },
          ],
        }),
      ),
    ) as [{ message: { content: Array<Record<string, unknown>> } }];
    const content = msg.message.content;
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({ type: "text", text: "看图说话" });
    expect(content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "aW1n" },
    });
    expect(content[2]).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "cGRm" },
    });
  });
});
