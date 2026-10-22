// 2026-10-19-thinking-zh-translate / FR-01·FR-03：离线翻译 client 单测。
//
// 覆盖维度：
//   1. needsTranslation 启发式——中文为主/过短/无拉丁字母跳过，英文为主通过
//      （与后端 chunking.py 同规则，前端跳过 = 零请求）；
//   2. splitIntoChunks——拼接保真、上限合规、贪心合并；
//   3. 合批与去重——250ms 窗口内多条文本合为单请求、同文本共享单次在途；
//   4. 缓存——同文本第二次调用零请求；
//   5. 降级——engine_ready=false / 网络失败 → null + 60s 退避（退避期内零请求）。
//
// apiFetch 全量 mock（不触网）；fake timers 推进 250ms 合批窗口。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import {
  needsTranslation,
  resetThinkingTranslateForTests,
  splitIntoChunks,
  translateText,
} from "@/lib/thinking-translate";

function okResponse(items: { id: string; text: string; translated: boolean }[]) {
  return { ok: true, engine_ready: true, reason: null, items };
}

beforeEach(() => {
  resetThinkingTranslateForTests();
  apiFetchMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("needsTranslation 启发式（与后端同规则）", () => {
  it("英文为主且够长 → true", () => {
    expect(needsTranslation("The agent decided to read the config file before migrating.")).toBe(
      true,
    );
  });
  it("中文为主 → false", () => {
    expect(needsTranslation("这段思考内容大部分是中文，夹杂少量 English 单词而已。")).toBe(false);
  });
  it("过短 → false", () => {
    expect(needsTranslation("too short")).toBe(false);
  });
  it("无字母 → false", () => {
    expect(needsTranslation("1234 5678 9012 3456 !!! ???")).toBe(false);
  });
});

describe("splitIntoChunks 分块", () => {
  it("短文单块", () => {
    expect(splitIntoChunks("hello world")).toEqual(["hello world"]);
  });
  it("拼接保真（段界归上一块尾）", () => {
    const text = "Para one.\n\nPara two.\n\n\nPara three.";
    expect(splitIntoChunks(text, 100).join("")).toBe(text);
  });
  it("超长文切块且每块 ≤ 上限", () => {
    const text = "Sentence about agent reasoning. ".repeat(300); // ~9900 字符
    const chunks = splitIntoChunks(text, 1800);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1800)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });
});

describe("translateText 合批/缓存/降级", () => {
  it("不值得翻 → 立即 null 零请求", async () => {
    const out = await translateText("这段中文思考不需要翻译。");
    expect(out).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("250ms 窗口内多条合为单请求，同文本去重共享单次在途", async () => {
    apiFetchMock.mockResolvedValue(
      okResponse([
        { id: "0", text: "译甲", translated: true },
        { id: "1", text: "译乙", translated: true },
      ]),
    );
    const p1 = translateText("first english thinking text worth translating.");
    const p1dup = translateText("first english thinking text worth translating.");
    const p2 = translateText("second english thinking text also worth it.");
    await vi.advanceTimersByTimeAsync(250);
    const [out1, out2] = await Promise.all([p1, p2]);
    await p1dup;
    expect(out1).toBe("译甲");
    expect(out2).toBe("译乙");
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const body = (apiFetchMock.mock.calls[0]![1] as { json: { items: unknown[]; target: string } }).json;
    expect(body.items).toHaveLength(2); // 去重后 2 条
    expect(body.target).toBe("zh");
  });

  it("缓存命中——同文本第二次调用零请求", async () => {
    const text = "cached english text for the second call check.";
    apiFetchMock.mockResolvedValue(okResponse([{ id: "0", text: "译缓存", translated: true }]));
    const first = translateText(text);
    await vi.advanceTimersByTimeAsync(250);
    await expect(first).resolves.toBe("译缓存");
    await expect(translateText(text)).resolves.toBe("译缓存");
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("engine_ready=false → null 且 60s 退避期内后续调用零请求", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      engine_ready: false,
      reason: "no model",
      items: [{ id: "0", text: "x", translated: false }],
    });
    const p1 = translateText("engine unavailable backoff english text.");
    await vi.advanceTimersByTimeAsync(250);
    await expect(p1).resolves.toBeNull();
    // 退避期内：新文本直接 null，不再发请求
    await expect(translateText("another english text during backoff window.")).resolves.toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    // 退避期满（advance 60s+）恢复请求
    await vi.advanceTimersByTimeAsync(60_100);
    apiFetchMock.mockResolvedValue(
      okResponse([{ id: "0", text: "恢复了", translated: true }]),
    );
    const p2 = translateText("recovered english text after backoff expires.");
    await vi.advanceTimersByTimeAsync(250);
    await expect(p2).resolves.toBe("恢复了");
  });

  it("请求显式带 20s 超时（后端卡住时由 apiFetch 中止，不退化为无限等待）", async () => {
    apiFetchMock.mockResolvedValue(okResponse([{ id: "0", text: "译超时", translated: true }]));
    const p = translateText("timeout option english thinking text check.");
    await vi.advanceTimersByTimeAsync(250);
    await expect(p).resolves.toBe("译超时");
    const options = apiFetchMock.mock.calls[0]![1] as { timeoutMs?: number };
    expect(options.timeoutMs).toBe(20_000);
  });

  it("超时（apiFetch reject timeout）→ null + 60s 退避", async () => {
    const timeoutErr = Object.assign(new Error("请求超时"), { code: "timeout" });
    apiFetchMock.mockRejectedValue(timeoutErr);
    const p = translateText("timed out english thinking text for backoff window.");
    await vi.advanceTimersByTimeAsync(250);
    await expect(p).resolves.toBeNull();
    // 退避期内新文本直接回退原文，不再发请求
    await expect(translateText("another text inside timeout backoff window.")).resolves.toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("网络失败（apiFetch reject）→ null + 退避", async () => {
    apiFetchMock.mockRejectedValue(new Error("network down"));
    const p = translateText("network failure path english text check.");
    await vi.advanceTimersByTimeAsync(250);
    await expect(p).resolves.toBeNull();
    await expect(translateText("second text after network failure.")).resolves.toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("超长文按块拆分为多个 item，译文按序拼回", async () => {
    const part = "Long english paragraph for chunk splitting test. ".repeat(40); // ~2640
    const text = `${part}\n\n${part}`;
    apiFetchMock.mockImplementation(
      async (_path: string, options: { json: { items: Array<{ id: string; text: string }> } }) => {
        const items = options.json.items.map((it, idx) => ({
          id: it.id,
          text: `[${idx}]`,
          translated: true,
        }));
        return okResponse(items);
      },
    );
    const p = translateText(text);
    await vi.advanceTimersByTimeAsync(250);
    const out = await p;
    const body = (apiFetchMock.mock.calls[0]![1] as { json: { items: Array<{ text: string }> } }).json;
    expect(body.items.length).toBeGreaterThan(1);
    expect(body.items.every((it) => it.text.length <= 1800)).toBe(true);
    expect(out).toBe(body.items.map((_, i) => `[${i}]`).join(""));
  });

  it("评审 P2 回归：>16 块巨型文本跨多批续传不卡队（旧形态空批 return 后队列永久卡死）", async () => {
    // ~45000 字符 → 25 块（1800/块），超单批 16 上限，需两批接力
    const sentence = "Giant english thinking text spanning many chunk batches. ";
    const text = sentence.repeat(800); // ~46400
    apiFetchMock.mockImplementation(
      async (_path: string, options: { json: { items: Array<{ id: string; text: string }> } }) => {
        const items = options.json.items.map((it) => ({
          id: it.id,
          text: it.text.length === 0 ? "" : `${it.text.length}`,
          translated: true,
        }));
        return okResponse(items);
      },
    );
    const p = translateText(text);
    // 第一批（16 块）后仍剩 9 块在队——批完成回调须已排程下一轮 flush
    await vi.advanceTimersByTimeAsync(250);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    const out = await p;
    // 每块译文=块字符数，拼接后总长=原文字符数（按序无损重组）
    expect(out).toBe(splitIntoChunks(text).map((c) => `${c.length}`).join(""));
  });
});
