/**
 * task-06 / 变更 2026-09-09-askuser-pi-cursor：askuser-marker 解析器单测。
 *
 * 依据:
 *   - frontend/src/lib/askuser-marker.ts（parseAskUserMarker / AskUserMarkerPayload）
 *   - 变更 design §Wave B.2 宽容边界清单（R-01：解析宽容多形态，非法降级普通文本）
 *
 * 覆盖（正反例全清单）:
 *   合法：单行/多行 JSON、尾随空白与空白变体（开栏行尾随空格/闭合行行首空白/CRLF）、
 *         四 kind 枚举、防御性字段归一、长正文尾部窗口坐标映射、多标记块取尾块、
 *         载荷恰 4096 字符边界
 *   非法：坏 JSON、缺 kind/question、question 非字符串/纯空白、kind 越界、
 *         载荷 4097 字符、标记在中部、```json 等其它语言标注、大小写/额外词、
 *         裸 JSON 无围栏、未闭合围栏、空载荷块、空文本、>8KB 尾随空白顶出窗口、
 *         非字符串输入、JSON 顶层非对象
 *
 * 风格对齐 lib/__tests__/mcp-tokens.test.ts（中文用例标题 + 文件头覆盖清单）。
 */

import { describe, expect, it } from "vitest";

import { parseAskUserMarker } from "@/lib/askuser-marker";

/** 标准形态围栏：```askuser + JSON + 闭合围栏（变体用例在测试内手写） */
const fence = (json: string): string => "```askuser\n" + json + "\n```";

describe("parseAskUserMarker · 合法形态", () => {
  it("单行 JSON 全字段：payload 精确解析，textBefore 原样保留标记前正文", () => {
    const json =
      '{"kind":"select","question":"选哪个方案？","options":[{"label":"方案A"},{"label":"方案B"}],' +
      '"allowCustom":false,"recommendResponders":["张三"]}';
    const text = "我先分析完依赖了。\n请选择下一步：\n" + fence(json);

    expect(parseAskUserMarker(text)).toEqual({
      payload: {
        kind: "select",
        question: "选哪个方案？",
        options: [{ label: "方案A" }, { label: "方案B" }],
        allowCustom: false,
        recommendResponders: ["张三"],
      },
      textBefore: "我先分析完依赖了。\n请选择下一步：\n",
    });
  });

  it("多行格式化 JSON（confirm，无可选字段）", () => {
    const json = [
      "{",
      '  "kind": "confirm",',
      '  "question": "确认删除这个工作区吗？"',
      "}",
    ].join("\n");

    expect(parseAskUserMarker(fence(json))).toEqual({
      payload: { kind: "confirm", question: "确认删除这个工作区吗？" },
      textBefore: "",
    });
  });

  it("纯标记无正文：textBefore 为空串", () => {
    expect(parseAskUserMarker(fence('{"kind":"input","question":"补充路径？"}'))).toEqual({
      payload: { kind: "input", question: "补充路径？" },
      textBefore: "",
    });
  });

  it("尾随空白/空白变体容忍：闭合围栏后空白、开栏行尾随空白、闭合行行首空白、CRLF", () => {
    // a) 闭合围栏后的换行/空格/tab
    expect(
      parseAskUserMarker(fence('{"kind":"confirm","question":"a？"}') + "\n\n  \t"),
    ).toEqual({
      payload: { kind: "confirm", question: "a？" },
      textBefore: "",
    });
    // b) 开栏 token 后行内空白 + 闭合围栏行行首空白
    expect(
      parseAskUserMarker('正文\n```askuser \t\n{"kind":"input","question":"b？"}\n  ```'),
    ).toEqual({
      payload: { kind: "input", question: "b？" },
      textBefore: "正文\n",
    });
    // c) 全文 CRLF 行尾（Windows 兼容，CLAUDE.md 规则 13）
    expect(
      parseAskUserMarker(
        '正文\r\n```askuser\r\n{"kind":"editor","question":"c？"}\r\n```\r\n',
      ),
    ).toEqual({
      payload: { kind: "editor", question: "c？" },
      textBefore: "正文\r\n",
    });
  });

  it("editor kind + allowCustom=true + recommendResponders 透传", () => {
    const json =
      '{"kind":"editor","question":"请给出重构方案","allowCustom":true,' +
      '"recommendResponders":["张三","李四"]}';

    expect(parseAskUserMarker(fence(json))).toEqual({
      payload: {
        kind: "editor",
        question: "请给出重构方案",
        allowCustom: true,
        recommendResponders: ["张三", "李四"],
      },
      textBefore: "",
    });
  });

  it.each(["select", "confirm", "input", "editor"] as const)(
    "kind=%s 枚举值均合法",
    (kind) => {
      const result = parseAskUserMarker(
        fence(JSON.stringify({ kind, question: "继续吗？" })),
      );
      expect(result?.payload.kind).toBe(kind);
      expect(result?.payload.question).toBe("继续吗？");
    },
  );

  it("防御性字段归一：options 坏条目丢弃、allowCustom 类型不符忽略、responders 混合过滤、未知字段忽略", () => {
    const json = JSON.stringify({
      kind: "select",
      question: "选方案",
      options: [
        { label: "方案A" },
        { label: "" },
        { label: "   " },
        { label: 42 },
        "不是对象",
        null,
        { label: "方案B", value: 9 },
      ],
      allowCustom: "yes",
      recommendResponders: [42, "张三", true, "", "  ", "李四"],
      extraField: "忽略",
    });

    expect(parseAskUserMarker(fence(json))).toEqual({
      payload: {
        kind: "select",
        question: "选方案",
        options: [{ label: "方案A" }, { label: "方案B" }],
        recommendResponders: ["张三", "李四"],
      },
      textBefore: "",
    });
  });

  it("可选字段整体类型不符（非数组/非布尔）时忽略该字段，不整体拒收", () => {
    const json =
      '{"kind":"input","question":"路径？","options":"A|B","allowCustom":1,' +
      '"recommendResponders":"张三"}';

    expect(parseAskUserMarker(fence(json))).toEqual({
      payload: { kind: "input", question: "路径？" },
      textBefore: "",
    });
  });

  it("长正文 + 尾部标记：8KB 窗口内识别，textBefore 坐标映射回原文（非窗口坐标）", () => {
    const body = "析".repeat(50_000); // 5 万 CJK 字符，窗口从正文中间起切
    const text = body + "\n" + fence('{"kind":"input","question":"补充路径？"}');

    const result = parseAskUserMarker(text);
    expect(result?.payload.kind).toBe("input");
    expect(result?.textBefore).toBe(body + "\n");
  });

  it("多个 askuser 块：取最后一个（模型重试），textBefore 含前序坏块", () => {
    const good = '{"kind":"confirm","question":"现在部署吗？"}';
    const text = "正文\n```askuser\n{broken\n```\n```askuser\n" + good + "\n```";

    expect(parseAskUserMarker(text)).toEqual({
      payload: { kind: "confirm", question: "现在部署吗？" },
      textBefore: "正文\n```askuser\n{broken\n```\n",
    });
  });

  it("载荷恰好 4096 字符：边界值通过", () => {
    const wrap = (n: number) =>
      `{"kind":"input","question":${JSON.stringify("a".repeat(n))}}`;
    const base = wrap(0).length; // {"kind":"input","question":""}
    const at4096 = wrap(4096 - base);
    expect(at4096.length).toBe(4096);

    const result = parseAskUserMarker(fence(at4096));
    expect(result?.payload.kind).toBe("input");
    expect(result?.payload.question.length).toBe(4096 - base);
  });
});

describe("parseAskUserMarker · 非法形态（一律 null，不抛异常）", () => {
  it("坏 JSON（key 未加引号）", () => {
    expect(parseAskUserMarker(fence("{kind:\"select\",question:\"q\"}"))).toBeNull();
  });

  it("缺 kind", () => {
    expect(parseAskUserMarker(fence('{"question":"选哪个？"}'))).toBeNull();
  });

  it("缺 question", () => {
    expect(
      parseAskUserMarker(fence('{"kind":"select","options":[{"label":"A"}]}')),
    ).toBeNull();
  });

  it("question 非字符串（数字）", () => {
    expect(
      parseAskUserMarker(fence('{"kind":"select","question":42}')),
    ).toBeNull();
  });

  it("question 空串/纯空白视为缺失", () => {
    expect(parseAskUserMarker(fence('{"kind":"select","question":""}'))).toBeNull();
    expect(parseAskUserMarker(fence('{"kind":"select","question":"   "}'))).toBeNull();
  });

  it("kind 不在四枚举内（choice）", () => {
    expect(
      parseAskUserMarker(fence('{"kind":"choice","question":"选哪个？"}')),
    ).toBeNull();
  });

  it("载荷 4097 字符：超 4KB 拒（边界值+1）", () => {
    const wrap = (n: number) =>
      `{"kind":"input","question":${JSON.stringify("a".repeat(n))}}`;
    const at4097 = wrap(4097 - wrap(0).length);
    expect(at4097.length).toBe(4097);

    expect(parseAskUserMarker(fence(at4097))).toBeNull();
  });

  it("标记在文本中部（闭合围栏后还有正文）不认", () => {
    const text =
      "见下方提问\n" +
      fence('{"kind":"select","question":"选哪个？"}') +
      "\n以上问题请考虑。";
    expect(parseAskUserMarker(text)).toBeNull();
  });

  it("其它语言标注（```json 内是合法 askuser JSON）不吞", () => {
    const json = JSON.stringify({
      kind: "select",
      question: "选哪个？",
      options: [{ label: "A" }],
    });
    expect(parseAskUserMarker("配置如下\n```json\n" + json + "\n```")).toBeNull();
  });

  it("大小写变体（```AskUser）与语言词后额外词（```askuser extra）不认", () => {
    const json = '{"kind":"confirm","question":"继续吗？"}';
    expect(parseAskUserMarker("```AskUser\n" + json + "\n```")).toBeNull();
    expect(parseAskUserMarker("```askuser extra\n" + json + "\n```")).toBeNull();
  });

  it("裸 JSON 无围栏", () => {
    expect(
      parseAskUserMarker('正文\n{"kind":"select","question":"选哪个？"}'),
    ).toBeNull();
  });

  it("未闭合围栏（缺闭合 ```）", () => {
    expect(
      parseAskUserMarker('```askuser\n{"kind":"confirm","question":"继续吗？"}'),
    ).toBeNull();
  });

  it("空载荷块（开栏后直接闭合）", () => {
    expect(parseAskUserMarker("```askuser\n```")).toBeNull();
  });

  it("空文本 / 纯空白文本", () => {
    expect(parseAskUserMarker("")).toBeNull();
    expect(parseAskUserMarker("   \n\t")).toBeNull();
  });

  it("尾随空白超过 8KB 把开栏顶出窗口：窗口外不扫描", () => {
    const text = fence('{"kind":"confirm","question":"继续吗？"}') + "\n".repeat(9000);
    expect(parseAskUserMarker(text)).toBeNull();
  });

  it("非字符串输入不抛异常且返回 null", () => {
    expect(() => parseAskUserMarker(null as unknown as string)).not.toThrow();
    expect(parseAskUserMarker(null as unknown as string)).toBeNull();
    expect(parseAskUserMarker(undefined as unknown as string)).toBeNull();
    expect(parseAskUserMarker(123 as unknown as string)).toBeNull();
  });

  it("JSON 顶层非对象（数组/字符串/数字/布尔）", () => {
    expect(parseAskUserMarker(fence("[1,2]"))).toBeNull();
    expect(parseAskUserMarker(fence('"str"'))).toBeNull();
    expect(parseAskUserMarker(fence("123"))).toBeNull();
    expect(parseAskUserMarker(fence("true"))).toBeNull();
  });
});
