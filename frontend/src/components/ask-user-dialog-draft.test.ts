/**
 * AskUser 作答草稿 localStorage 模块测试（2026-10-23-askuser-dialog-draft / FR-03 / FR-04）。
 *
 * 覆盖：
 *   - 读写往返（键 `sillyhub.askuser.draft.<requestId>`、结构 v/at/states）；
 *   - 跨 requestId 隔离（一个提问的草稿不出现在另一个提问）；
 *   - TTL 过期：超龄条目在写入时被 prune（孤儿兜底），新鲜条目保留；
 *   - prune 只碰自己的前缀（不误删会话输入草稿 `sillyhub.sessions.draft.*`）；
 *   - 损坏/结构不符数据降级返回 null 并清掉该条；
 *   - 清除接口删键。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASKUSER_DRAFT_PREFIX,
  ASKUSER_DRAFT_TTL_MS,
  clearAskUserDraft,
  readAskUserDraft,
  writeAskUserDraft,
} from "@/components/ask-user-dialog-draft";

const key = (id: string) => `${ASKUSER_DRAFT_PREFIX}${id}`;

const sample = {
  "0": { selected: ["使用项目本地目录"], customText: "" },
  "1": { selected: [], customText: "自定义输入" },
};

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("ask-user-dialog-draft 读写", () => {
  it("写入后可读回同一份 states（键按 requestId 组装）", () => {
    writeAskUserDraft("req-1", sample);
    expect(readAskUserDraft("req-1")).toEqual(sample);
    expect(window.localStorage.getItem(key("req-1"))).toBeTruthy();
  });

  it("跨 requestId 隔离：一个提问的草稿不出现在另一个提问", () => {
    writeAskUserDraft("req-1", sample);
    expect(readAskUserDraft("req-2")).toBeNull();
  });

  it("未写入过的 requestId 返回 null", () => {
    expect(readAskUserDraft("req-none")).toBeNull();
  });

  it("clear 删除该提问草稿", () => {
    writeAskUserDraft("req-1", sample);
    clearAskUserDraft("req-1");
    expect(readAskUserDraft("req-1")).toBeNull();
    expect(window.localStorage.getItem(key("req-1"))).toBeNull();
  });
});

describe("ask-user-dialog-draft TTL 与容错", () => {
  it("读取超龄草稿返回 null 并清掉该条", () => {
    const at = Date.now() - ASKUSER_DRAFT_TTL_MS - 1000;
    window.localStorage.setItem(
      key("req-old"),
      JSON.stringify({ v: 1, at, states: sample }),
    );
    expect(readAskUserDraft("req-old")).toBeNull();
    expect(window.localStorage.getItem(key("req-old"))).toBeNull();
  });

  it("写入时 prune 超龄条目、保留新鲜条目", () => {
    const oldAt = Date.now() - ASKUSER_DRAFT_TTL_MS - 1000;
    window.localStorage.setItem(
      key("req-old"),
      JSON.stringify({ v: 1, at: oldAt, states: sample }),
    );
    writeAskUserDraft("req-new", sample);
    expect(window.localStorage.getItem(key("req-old"))).toBeNull();
    expect(readAskUserDraft("req-new")).toEqual(sample);
  });

  it("prune 不碰其它前缀（会话输入草稿保留）", () => {
    const oldAt = Date.now() - ASKUSER_DRAFT_TTL_MS - 1000;
    window.localStorage.setItem(
      "sillyhub.sessions.draft.sess-a",
      "不该被删",
    );
    window.localStorage.setItem(
      key("req-old"),
      JSON.stringify({ v: 1, at: oldAt, states: sample }),
    );
    writeAskUserDraft("req-new", sample);
    expect(window.localStorage.getItem("sillyhub.sessions.draft.sess-a")).toBe(
      "不该被删",
    );
  });

  it("损坏 JSON / 结构不符降级 null 且清掉该条", () => {
    window.localStorage.setItem(key("req-bad"), "{not json");
    expect(readAskUserDraft("req-bad")).toBeNull();
    expect(window.localStorage.getItem(key("req-bad"))).toBeNull();

    window.localStorage.setItem(
      key("req-shape"),
      JSON.stringify({ v: 1, at: Date.now(), states: "oops" }),
    );
    expect(readAskUserDraft("req-shape")).toBeNull();
    expect(window.localStorage.getItem(key("req-shape"))).toBeNull();
  });

  it("states 内条目结构不符时该条被丢弃（不整份崩）", () => {
    window.localStorage.setItem(
      key("req-partial"),
      JSON.stringify({
        v: 1,
        at: Date.now(),
        states: {
          "0": { selected: ["A"], customText: "" },
          "1": { selected: "not-array", customText: 1 },
        },
      }),
    );
    expect(readAskUserDraft("req-partial")).toEqual({
      "0": { selected: ["A"], customText: "" },
    });
  });
});
