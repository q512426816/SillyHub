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
  requestTimeoutMsFor,
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

describe("requestTimeoutMsFor 超时预算（与后端 engine._timeout_for 公式同源）", () => {
  it("单块 = 基准 + 余量；按最坏后端块数（每 1000 字符一块）线性放宽", () => {
    expect(requestTimeoutMsFor([{ chunk: "x".repeat(40) }])).toBe(25_000);
    expect(requestTimeoutMsFor([{ chunk: "y".repeat(1800) }])).toBe(27_500); // 2 后端块
    expect(requestTimeoutMsFor([{ chunk: "z".repeat(1000) }])).toBe(25_000); // 恰 1000 → 1 块
  });
  it("满批 16×1800 最坏 32 后端块 = 后端公式 97.5s + 5s 余量（有界兜底）", () => {
    const worst = Array.from({ length: 16 }, () => ({ chunk: "w".repeat(1800) }));
    expect(requestTimeoutMsFor(worst)).toBe(102_500);
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

  it("请求超时按批动态——单块=基准+余量（后端卡住时仍由 apiFetch 中止兜底）", async () => {
    apiFetchMock.mockResolvedValue(okResponse([{ id: "0", text: "译超时", translated: true }]));
    const p = translateText("timeout option english thinking text check.");
    await vi.advanceTimersByTimeAsync(250);
    await expect(p).resolves.toBe("译超时");
    const options = apiFetchMock.mock.calls[0]![1] as { timeoutMs?: number };
    expect(options.timeoutMs).toBe(25_000); // 1 个后端块：20s 基准 + 5s 余量
  });

  it("满批 16×1800 的 timeoutMs ≥ 后端公式 97.5s——不再被固定 20s 误杀（2026-10-23 FR-01）", async () => {
    apiFetchMock.mockImplementation(
      async (_path: string, options: { json: { items: Array<{ id: string }> } }) =>
        okResponse(options.json.items.map((it, idx) => ({ id: it.id, text: `[${idx}]`, translated: true }))),
    );
    // 单段无段界长文 → 恰按 1800 硬切成 16 块满批（15×1800 + 1560）
    const sentence = "Full batch budget english thinking sentence check. ";
    const text = sentence.repeat(560); // ~28560 字符 → 16 块单批
    const p = translateText(text);
    await vi.advanceTimersByTimeAsync(250);
    await p;
    const options = apiFetchMock.mock.calls[0]![1] as {
      timeoutMs?: number;
      json: { items: Array<{ text: string }> };
    };
    expect(options.json.items).toHaveLength(16);
    // 最坏 32 个后端块（1800 → 2×1000）：20s + 31×2.5s = 97.5s，前端再 +5s 余量
    expect(options.timeoutMs).toBeGreaterThanOrEqual(20_000 + 31 * 2_500);
    expect(options.timeoutMs).toBe(102_500);
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

  it("2xx 脏响应体（null）→ 本批回退原文+退避，Promise 不悬挂（2026-10-23-review-risk-fixes-2 FR-04）", async () => {
    // apiFetch 2xx 时 safeJsonParse 失败得 null 原样透出——旧实现 resp.engine_ready
    // 解引用抛错后无人兜底：该批 Assembler 永不 settle（UI 恒「翻译中」）+ inflight 泄漏
    apiFetchMock.mockResolvedValue(null);
    const p1 = translateText("dirty response body english thinking text case.");
    await vi.advanceTimersByTimeAsync(250);
    await expect(p1).resolves.toBeNull();
    // 退避期内：新文本零请求直接回退
    await expect(translateText("second text during dirty body backoff.")).resolves.toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("畸形响应缺 items → 同款降级 resolve null（不悬挂）", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, engine_ready: true, reason: null });
    const p = translateText("malformed items missing english thinking text.");
    await vi.advanceTimersByTimeAsync(250);
    await expect(p).resolves.toBeNull();
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
