// lib/__tests__/session-mention.test.ts
// task-01（2026-08-26-session-input-mention）：detectMention / applyMentionPick 纯函数单测。
//
// 覆盖（对齐 task 卡 implementation + 测试质量清单：正常 + 边界 + 异常）：
//   1. 触发检测：行首 / 与 @、空格后 / 与 @、换行/制表符后（任意空白词界）。
//   2. 非词首不触发：foo/bar、a@b、最近触发字符非词首（/a@b 取最近 @ → null）。
//   3. 空白中断：查询串含空格/换行 → null；光标停在查询串中间（空白前）仍命中。
//   4. 空查询：刚输入触发字符即命中（query=""）；caret=0 / 空文本 → null。
//   5. 回填：/ 与 @ 的文本与光标精确断言（尾随空格、光标位于插入片段之后）、
//      光标后有剩余文本时的拼接、@ 自然键无空格。
//   6. /team 兼容链：回填后浮层检测归零（detectMention → null）+ 整条前缀仍命中
//      session-panel.tsx parseTeamCommand 拦截正则（函数未导出，测试内联同款正则，
//      来源 session-panel.tsx:418 /^\/team(?:\s+([\s\S]*))?$/）。
import { describe, expect, it } from "vitest";
import {
  applyMentionPick,
  detectMention,
  sanitizePpmInsertKey,
  type MentionDetection,
  type MentionPpmItem,
} from "../session-mention";

/** session-panel.tsx parseTeamCommand 同款正则（未导出，内联断言拦截兼容）。 */
const TEAM_COMMAND_RE = /^\/team(?:\s+([\s\S]*))?$/;

describe("detectMention 触发检测", () => {
  it("行首 / 命中，返回 trigger/query/start", () => {
    expect(detectMention("/dep", 4)).toEqual({
      trigger: "/",
      query: "dep",
      start: 0,
    });
  });

  it("行首 @ 命中", () => {
    expect(detectMention("@ql", 3)).toEqual({
      trigger: "@",
      query: "ql",
      start: 0,
    });
  });

  it("空格后 / 命中（start 指向触发字符）", () => {
    expect(detectMention("帮我 /arch", 9)).toEqual({
      trigger: "/",
      query: "arch",
      start: 3,
    });
  });

  it("空格后 @ 命中", () => {
    expect(detectMention("看下 @2026", 10)).toEqual({
      trigger: "@",
      query: "2026",
      start: 3,
    });
  });

  it("换行与制表符后命中（任意空白均为词界）", () => {
    expect(detectMention("a\n/scan", 7)).toEqual({
      trigger: "/",
      query: "scan",
      start: 2,
    });
    expect(detectMention("a\t@ql", 5)).toEqual({
      trigger: "@",
      query: "ql",
      start: 2,
    });
  });

  it("空查询命中（刚输入触发字符）", () => {
    expect(detectMention("/", 1)).toEqual({
      trigger: "/",
      query: "",
      start: 0,
    });
    expect(detectMention("x @", 3)).toEqual({
      trigger: "@",
      query: "",
      start: 2,
    });
  });

  it("非词首的 / 不触发", () => {
    expect(detectMention("foo/bar", 7)).toBeNull();
    expect(detectMention("a@b/c", 5)).toBeNull();
  });

  it("非词首的 @ 不触发", () => {
    expect(detectMention("user@example", 12)).toBeNull();
  });

  it("取最近触发字符：/a@b 的 @ 非词首 → null（不回退到更左的 /）", () => {
    expect(detectMention("/a@b", 4)).toBeNull();
  });

  it("查询串含空格 → null（空白中断关浮层）", () => {
    expect(detectMention("/foo bar", 8)).toBeNull();
    expect(detectMention("@a b c", 6)).toBeNull();
  });

  it("查询串含换行 → null", () => {
    expect(detectMention("/foo\nbar", 7)).toBeNull();
  });

  it("光标停在查询串中间（空白之前）仍命中，query 截到光标", () => {
    expect(detectMention("/hello world", 6)).toEqual({
      trigger: "/",
      query: "hello",
      start: 0,
    });
  });

  it("光标左侧全是普通字符（无触发字符）→ null", () => {
    expect(detectMention("普通文本", 4)).toBeNull();
    expect(detectMention("abc", 3)).toBeNull();
  });

  it("空文本与光标在行首 → null", () => {
    expect(detectMention("", 0)).toBeNull();
    expect(detectMention("/foo", 0)).toBeNull();
  });

  it("光标越界时按文本长度收敛（防御：selectionStart 不会超过 value.length）", () => {
    expect(detectMention("/foo", 99)).toEqual({
      trigger: "/",
      query: "foo",
      start: 0,
    });
  });
});

describe("applyMentionPick 选中回填", () => {
  it("/ 回填：替换触发段为 /key + 尾随空格，光标在空格之后", () => {
    const mention: MentionDetection = { trigger: "/", query: "te", start: 0 };
    expect(applyMentionPick("/te", mention, "team")).toEqual({
      value: "/team ",
      caret: 6,
    });
  });

  it("@ 回填：自然键无空格 + 尾随空格", () => {
    const mention: MentionDetection = {
      trigger: "@",
      query: "2026",
      start: 3,
    };
    expect(
      applyMentionPick("看下 @2026", mention, "2026-08-26-session-input-mention"),
    ).toEqual({
      value: "看下 @2026-08-26-session-input-mention ",
      caret: 3 + 1 + 32 + 1, // start + 1(@) + 32(键长) + 1(尾随空格)
    });
  });

  it("@ 回填快速修复：ql- 短码自然键", () => {
    const mention: MentionDetection = { trigger: "@", query: "", start: 0 };
    expect(applyMentionPick("@", mention, "ql-20260826-013")).toEqual({
      value: "@ql-20260826-013 ",
      caret: 17,
    });
  });

  it("光标后有剩余文本：只替换触发段，剩余拼接保留", () => {
    const mention: MentionDetection = { trigger: "/", query: "he", start: 0 };
    expect(applyMentionPick("/hello world", mention, "help")).toEqual({
      value: "/help llo world",
      caret: 6,
    });
  });

  it("空查询回填（选内置 /team 时刚输入 /）", () => {
    const mention: MentionDetection = { trigger: "/", query: "", start: 0 };
    expect(applyMentionPick("/", mention, "team")).toEqual({
      value: "/team ",
      caret: 6,
    });
  });

  it("回填不修改入参（纯函数无副作用）", () => {
    const value = "/te 后文";
    const mention: MentionDetection = { trigger: "/", query: "te", start: 0 };
    const out = applyMentionPick(value, mention, "team");
    expect(out.value).toBe("/team  后文");
    expect(value).toBe("/te 后文");
    expect(mention).toEqual({ trigger: "/", query: "te", start: 0 });
  });
});

describe("/team 拦截兼容链（design §3.4 / 验收第 3 条）", () => {
  it("联想回填 /team 后：浮层检测归零 + 整条前缀仍命中拦截", () => {
    // 用户输入 "/te" 从浮层选中 team → 回填
    const picked = applyMentionPick(
      "/te",
      { trigger: "/", query: "te", start: 0 },
      "team",
    );
    expect(picked.value).toBe("/team ");
    // 1) 尾随空格使下一次 detectMention 查询串含空白 → null（浮层自动关闭）
    expect(detectMention(picked.value, picked.caret)).toBeNull();
    // 2) 整条 "/team " 仍命中 parseTeamCommand 拦截（剥离后目标文本为空串）
    const m = TEAM_COMMAND_RE.exec(picked.value);
    expect(m).not.toBeNull();
    expect((m?.[1] ?? "").trim()).toBe("");
  });

  it("回填后继续输入参数仍命中拦截（剥离前缀语义不受影响）", () => {
    const picked = applyMentionPick(
      "/te",
      { trigger: "/", query: "te", start: 0 },
      "team",
    );
    const withArgs = picked.value + "分析下登录";
    expect(TEAM_COMMAND_RE.test(withArgs)).toBe(true);
    expect((TEAM_COMMAND_RE.exec(withArgs)?.[1] ?? "").trim()).toBe("分析下登录");
  });
});

/* ───────── task-06（2026-08-28-session-ppm-task-binding / FR-02）：PPM 条目 ───────── */

describe("MentionPpmItem 类型与 sanitizePpmInsertKey 回填键清洗", () => {
  it("MentionPpmItem 结构：kind/id/title/projectName/subtitle（任务/问题归一形态）", () => {
    const item: MentionPpmItem = {
      kind: "plan_task",
      id: "0b6dc46e-5b60-4a06-9c6f-8b42eec5b58a",
      title: "排行榜接口性能优化",
      projectName: "SillyHub 平台",
      subtitle: null,
    };
    // 判别消费面：kind 兼容 daemon.ts PpmItemKind 字面量、problem 同构。
    const problem: MentionPpmItem = { ...item, kind: "problem" };
    expect(item.kind).toBe("plan_task");
    expect(problem.kind).toBe("problem");
  });

  it("压连续空白（含换行/制表）为单空格 + 去首尾空白", () => {
    expect(sanitizePpmInsertKey("  排行榜\t接口\n性能  优化  ")).toBe(
      "排行榜 接口 性能 优化",
    );
  });

  it("超 40 字符截断加省略号（回填文本仅展示性残留，绑定走结构化槽位）", () => {
    const long = "一二三四五六七八九十".repeat(5); // 50 字符
    expect(sanitizePpmInsertKey(long)).toBe(`${"一二三四五六七八九十".repeat(4)}…`);
    expect(sanitizePpmInsertKey(long).length).toBe(41);
  });

  it("空标题（null/undefined/纯空白）返回空串", () => {
    expect(sanitizePpmInsertKey(null)).toBe("");
    expect(sanitizePpmInsertKey(undefined)).toBe("");
    expect(sanitizePpmInsertKey("   \n\t ")).toBe("");
  });

  it("清洗后的 PPM 键经 applyMentionPick 回填：尾随空格仍使检测归 null 关层", () => {
    // 标题含内部空格（清洗保留单空格）——回填段 "@排行榜 接口 性能 优化 "
    const key = sanitizePpmInsertKey("排行榜 接口\n性能优化");
    const picked = applyMentionPick("看下 @排行", {
      trigger: "@",
      query: "排行",
      start: 3,
    }, key);
    expect(picked.value).toBe("看下 @排行榜 接口 性能优化 ");
    expect(picked.caret).toBe(picked.value.length);
    // 尾随空格语义不受内部空格影响：光标回看遇空白 → null（浮层自动关闭）。
    expect(detectMention(picked.value, picked.caret)).toBeNull();
  });
});
