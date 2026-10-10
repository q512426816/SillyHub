// task-01（2026-10-09-attachment-inline-reference）：附件引用纯函数库单测。
// 覆盖：token 构建与同名唯一化分配（含文件名自带 ·N 的构造性碰撞）、删除不重排、
// strip 全量移除不误伤、发送置换 uuid 对齐与孤儿降级、历史解析拆段与非法容错。
import { describe, expect, it } from "vitest";

import {
  allocateAttRefToken,
  buildAttRefToken,
  parseInlineAttRefs,
  stripAttRefTokens,
  substituteAttRefsForSend,
} from "@/lib/attachment-refs";

const UUID_A = "aaaaaaaa-1111-2222-3333-444444444444";
const UUID_B = "bbbbbbbb-1111-2222-3333-444444444444";

describe("buildAttRefToken / allocateAttRefToken（FR-02 同名唯一化）", () => {
  it("seq=1 无后缀，seq>1 加 ·N", () => {
    expect(buildAttRefToken("截图.png", 1)).toBe("【截图.png】");
    expect(buildAttRefToken("截图.png", 3)).toBe("【截图.png·3】");
  });

  it("首个同名分配无后缀；占用并集内取最小可用序号", () => {
    expect(allocateAttRefToken("配置.json", [])).toBe("【配置.json】");
    // 已有【配置.json】→ 第二个同名取 ·2；·2 也被占（文件名自带后缀）→ 取 ·3。
    expect(allocateAttRefToken("配置.json", ["【配置.json】"])).toBe("【配置.json·2】");
    expect(
      allocateAttRefToken("配置.json", ["【配置.json】", "【配置.json·2】"]),
    ).toBe("【配置.json·3】");
  });

  it("删除不重排：剥离已删 token 后，剩余附件 token 文本不变", () => {
    // A=【配置.json】、B=【配置.json·2】已分配；A 删除剥离后，B 的映射仍是 ·2。
    const map = { [UUID_A]: "【配置.json】", [UUID_B]: "【配置.json·2】" };
    const afterStrip = stripAttRefTokens("看下【配置.json】和【配置.json·2】", [
      map[UUID_A]!,
    ]);
    expect(afterStrip).toBe("看下和【配置.json·2】");
    expect(map[UUID_B]).toBe("【配置.json·2】");
  });
});

describe("stripAttRefTokens（FR-05 删除联动）", () => {
  it("全量移除该 token 的所有出现，不误伤其它 token/正文", () => {
    const value = "第一处【A.png】中间文字第二处【A.png】旁边【B.png】";
    expect(stripAttRefTokens(value, ["【A.png】"])).toBe(
      "第一处中间文字第二处旁边【B.png】",
    );
  });

  it("token 不在正文 / 空 token：无操作", () => {
    expect(stripAttRefTokens("正文", ["【不在.png】"])).toBe("正文");
    expect(stripAttRefTokens("正文", [""])).toBe("正文");
  });
});

describe("substituteAttRefsForSend（FR-04 发送置换）", () => {
  const attachments = [
    { id: UUID_A, name: "配置.json" },
    { id: UUID_B, name: "配置.json" },
  ];

  it("token 置换为 uuid 锚定引用，同名两附件 uuid 可区分", () => {
    const value = "看这个【配置.json】和那个【配置.json·2】";
    const out = substituteAttRefsForSend(
      value,
      { [UUID_A]: "【配置.json】", [UUID_B]: "【配置.json·2】" },
      attachments,
    );
    expect(out).toBe(
      `看这个[附件引用:${UUID_A}|配置.json]和那个[附件引用:${UUID_B}|配置.json]`,
    );
  });

  it("孤儿 token（附件已删不在列表）原样保留；重复出现全量置换", () => {
    const value = "两处【配置.json】孤儿【已删.png】";
    const out = substituteAttRefsForSend(
      value,
      { [UUID_A]: "【配置.json】", [UUID_B]: "【已删.png】" },
      [attachments[0]!],
    );
    expect(out).toBe(`两处[附件引用:${UUID_A}|配置.json]孤儿【已删.png】`);
  });

  it("tokenMap 空 → 原样返回（零开销旁路）", () => {
    expect(substituteAttRefsForSend("【任意.png】", {}, [])).toBe("【任意.png】");
  });
});

describe("parseInlineAttRefs（FR-06 历史解析）", () => {
  it("拆 text/ref 段，ref 携带 uuid 与文件名", () => {
    const parts = parseInlineAttRefs(
      `前文[附件引用:${UUID_A}|截图.png]中文[附件引用:${UUID_B}|日志.txt]尾文`,
    );
    expect(parts).toEqual([
      { type: "text", value: "前文" },
      { type: "ref", value: "截图.png", ref: { id: UUID_A, name: "截图.png" } },
      { type: "text", value: "中文" },
      { type: "ref", value: "日志.txt", ref: { id: UUID_B, name: "日志.txt" } },
      { type: "text", value: "尾文" },
    ]);
  });

  it("无引用 → 单 text 段原样；uuid 形态非法 → 归 text 容错不丢字", () => {
    expect(parseInlineAttRefs("普通正文")).toEqual([
      { type: "text", value: "普通正文" },
    ]);
    const bad = "非法[附件引用:not-a-uuid|x.png]引用";
    expect(parseInlineAttRefs(bad)).toEqual([{ type: "text", value: bad }]);
  });
});
