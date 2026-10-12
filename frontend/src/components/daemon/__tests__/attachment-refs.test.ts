// task-01（2026-10-09-attachment-inline-reference）：附件引用纯函数库单测。
// 覆盖：token 构建与同名唯一化分配（含文件名自带 ·N 的构造性碰撞）、删除不重排、
// strip 全量移除不误伤、发送置换 uuid 对齐与孤儿降级、历史解析拆段与非法容错。
import { describe, expect, it } from "vitest";

import {
  allocateAttRefToken,
  allocateWsRefToken,
  buildAttRefToken,
  buildWsRefToken,
  parseInlineAttRefs,
  parseInlineRefs,
  stripAttRefTokens,
  stripWsRefTokens,
  substituteAttRefsForSend,
  substituteWsRefsForSend,
  type WsRefTokenMap,
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

  it("附件 name 含竖线：旧口径保持（ref 段 name 完整，不因工作区正则降级）", () => {
    const text = `[附件引用:${UUID_A}|a|b.png]`;
    expect(parseInlineAttRefs(text)).toEqual([
      { type: "ref", value: "a|b.png", ref: { id: UUID_A, name: "a|b.png" } },
    ]);
  });
});

// ── 工作区引用（2026-10-10-workspace-ref-intake task-01）────────────────

const WID = "cccccccc-1111-2222-3333-444444444444";

describe("buildWsRefToken / allocateWsRefToken（FR-02 并集唯一化，D-005）", () => {
  it("基名 = 名称(+行号段无 L 前缀)；seq>1 加 ·N", () => {
    expect(buildWsRefToken("design.md", undefined, 1)).toBe("【design.md】");
    expect(buildWsRefToken("design.md", [10, 16], 1)).toBe("【design.md:10-16】");
    expect(buildWsRefToken("design.md", undefined, 2)).toBe("【design.md·2】");
    expect(buildWsRefToken("a.py", [3, 5], 3)).toBe("【a.py:3-5·3】");
  });

  it("并集池：附件 token 与工作区 token 完全同名才 ·2（跨池撞名）", () => {
    // 池内已有附件 token【design.md】→ 工作区同名文件取 ·2。
    expect(allocateWsRefToken("design.md", ["【design.md】"])).toBe("【design.md·2】");
    // 池内已有工作区 code token【design.md:10-16】→ 同行段再分配取 ·2。
    expect(allocateWsRefToken("design.md:10-16", ["【design.md:10-16】"])).toBe(
      "【design.md:10-16·2】",
    );
  });

  it("异基名免序号：文件与代码块、不同行段互不加号", () => {
    // 文件 design.md vs 代码块 design.md:10-16 显示基名不同 → 各自 seq=1。
    expect(allocateWsRefToken("design.md:10-16", ["【design.md】"])).toBe(
      "【design.md:10-16】",
    );
    expect(allocateWsRefToken("design.md:20-30", ["【design.md】", "【design.md:10-16】"])).toBe(
      "【design.md:20-30】",
    );
  });
});

describe("stripWsRefTokens（FR-02 清除）", () => {
  it("全量移除工作区 token，不误伤附件 token 与正文", () => {
    const value = "文件【design.md】代码【a.py:3-5】附件【截图.png】";
    expect(stripWsRefTokens(value, ["【design.md】", "【a.py:3-5】"])).toBe(
      "文件代码附件【截图.png】",
    );
  });
});

describe("substituteWsRefsForSend（FR-06 三类置换，D-003/D-004）", () => {
  it("file/dir/code 三类 token 置换为对应正式标记", () => {
    const map: WsRefTokenMap = {
      "docs/design.md": {
        desc: { kind: "file", workspaceId: WID, path: "docs/design.md", name: "design.md" },
        token: "【design.md】",
      },
      "docs": {
        desc: { kind: "dir", workspaceId: WID, path: "docs", name: "docs" },
        token: "【docs】",
      },
      "src/a.py:10-16": {
        desc: { kind: "code", workspaceId: WID, path: "src/a.py", name: "a.py", lines: [10, 16] },
        token: "【a.py:10-16】",
      },
    };
    const out = substituteWsRefsForSend(
      "看【design.md】目录【docs】选段【a.py:10-16】",
      map,
    );
    expect(out).toBe(
      `看[文件引用:${WID}|docs/design.md]目录[目录引用:${WID}|docs]选段[代码引用:${WID}|src/a.py|L10-L16]`,
    );
  });

  it("目录引用根 path 空串 → 空尾段标记", () => {
    const map: WsRefTokenMap = {
      "": {
        desc: { kind: "dir", workspaceId: WID, path: "", name: "工作区根" },
        token: "【工作区根】",
      },
    };
    expect(substituteWsRefsForSend("根【工作区根】", map)).toBe(`根[目录引用:${WID}|]`);
  });

  it("孤儿 token（正文有但 map 无该映射）原样保留；map 空 → 原样返回", () => {
    expect(substituteWsRefsForSend("孤儿【手打的.md】", {})).toBe("孤儿【手打的.md】");
    const map: WsRefTokenMap = {
      "a.py:1-2": {
        desc: { kind: "code", workspaceId: WID, path: "a.py", name: "a.py", lines: [1, 2] },
        token: "【a.py:1-2】",
      },
    };
    expect(substituteWsRefsForSend("别家的【b.py:1-2】", map)).toBe("别家的【b.py:1-2】");
  });

  it("重复出现全量置换；与附件 token 互不误伤", () => {
    const map: WsRefTokenMap = {
      "x.md": {
        desc: { kind: "file", workspaceId: WID, path: "x.md", name: "x.md" },
        token: "【同名.png】",
      },
    };
    const out = substituteWsRefsForSend("两处【同名.png】附件【同名.png】", map);
    // token 文本相同则一并置换（同文本同锚，附件置换先行占位后此处不再出现）——
    // 互不误伤指映射键各管各池：附件 map 不含工作区条目。
    expect(out).toBe(`两处[文件引用:${WID}|x.md]附件[文件引用:${WID}|x.md]`);
  });
});

describe("parseInlineRefs（FR-07 统一解析）", () => {
  it("附件 + 三类标记混合拆段，段序正确", () => {
    const text =
      `附件[附件引用:${UUID_A}|截图.png]文件[文件引用:${WID}|docs/design.md]` +
      `目录[目录引用:${WID}|]代码[代码引用:${WID}|src/a.py|L10-L16]尾`;
    expect(parseInlineRefs(text)).toEqual([
      { type: "text", value: "附件" },
      { type: "ref", value: "截图.png", raw: `[附件引用:${UUID_A}|截图.png]`, ref: { kind: "att", id: UUID_A, name: "截图.png" } },
      { type: "text", value: "文件" },
      { type: "ref", value: "design.md", raw: `[文件引用:${WID}|docs/design.md]`, ref: { kind: "file", workspaceId: WID, path: "docs/design.md", name: "design.md" } },
      { type: "text", value: "目录" },
      { type: "ref", value: "工作区根", raw: `[目录引用:${WID}|]`, ref: { kind: "dir", workspaceId: WID, path: "", name: "工作区根" } },
      { type: "text", value: "代码" },
      { type: "ref", value: "a.py:10-16", raw: `[代码引用:${WID}|src/a.py|L10-L16]`, ref: { kind: "code", workspaceId: WID, path: "src/a.py", lines: [10, 16], name: "a.py:10-16" } },
      { type: "text", value: "尾" },
    ]);
  });

  it("纯文本 → 单 text 段（本变更前历史消息逐字不变）", () => {
    expect(parseInlineRefs("普通正文，无任何标记")).toEqual([
      { type: "text", value: "普通正文，无任何标记" },
    ]);
  });

  it("路径含竖线/行段非法 → 整段降级 text 原样（X-5 边界）；路径含右括号 → 最短合法匹配截断", () => {
    // 竖线不在 path 字符类：整段失配降级 text，不丢字。
    const bad1 = "坏[文件引用:" + WID + "|a|b.md]的";
    const bad3 = "坏[代码引用:" + WID + "|a.py|L10-L16x]的";
    expect(parseInlineRefs(bad1)).toEqual([{ type: "text", value: bad1 }]);
    expect(parseInlineRefs(bad3)).toEqual([{ type: "text", value: bad3 }]);
    // 右括号在 path 内无法表达：按最短合法边界解析（path="x"），余文归 text——
    // 拼接逐字还原，不误吞不丢字（X-5 声明的 ] 处理边界）。
    expect(parseInlineRefs("坏[目录引用:" + WID + "|x].md]的")).toEqual([
      { type: "text", value: "坏" },
      { type: "ref", value: "x", raw: `[目录引用:${WID}|x]`, ref: { kind: "dir", workspaceId: WID, path: "x", name: "x" } },
      { type: "text", value: ".md]的" },
    ]);
  });

  it("wid 形态非法 → 降级 text（uuid 口径）", () => {
    const bad = "坏[文件引用:not-a-wid|a.md]的";
    expect(parseInlineRefs(bad)).toEqual([{ type: "text", value: bad }]);
  });
});

describe("parseInlineAttRefs 兼容薄封装（D-009 既有消费零改动）", () => {
  it("工作区标记在旧解析里按普通文本透传（raw 还原为独立 text 段），拼接逐字还原", () => {
    const text = `前[文件引用:${WID}|a.md][代码引用:${WID}|a.py|L1-L2]后`;
    const parts = parseInlineAttRefs(text);
    // 拆段形态：前 / 标记原文 / 标记原文 / 后（text 段渲染原样，视觉等价单段）。
    expect(parts).toEqual([
      { type: "text", value: "前" },
      { type: "text", value: `[文件引用:${WID}|a.md]` },
      { type: "text", value: `[代码引用:${WID}|a.py|L1-L2]` },
      { type: "text", value: "后" },
    ]);
    // 拼接逐字还原（容错不丢字契约）。
    expect(parts.map((p) => p.value).join("")).toBe(text);
  });

  it("既有附件段拆分行为与旧口径一致", () => {
    const parts = parseInlineAttRefs(`a[附件引用:${UUID_A}|x.png]b`);
    expect(parts).toEqual([
      { type: "text", value: "a" },
      { type: "ref", value: "x.png", ref: { id: UUID_A, name: "x.png" } },
      { type: "text", value: "b" },
    ]);
  });
});
