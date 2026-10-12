"use client";

/**
 * 附件行内引用纯函数库（2026-10-09-attachment-inline-reference task-01，FR-02/FR-04，
 * D-002@v1/D-003@v1）。
 *
 * token 全生命周期（编辑态 → 发送 → 历史）的无副作用核心：
 * - 编辑态 token：`【文件名】`，同名冲突自动 `·N` 序号（D-002：序号按"正文已出现 +
 *   已分配映射"并集内最小可用分配，不随删除重排——删除附件联动剥离其 token 后，
 *   剩余同名附件的 token 文本不变）。
 * - 发送置换：token → `[附件引用:<uuid>|<文件名>]`（D-003：uuid 与随消息附件及头部
 *   标记行 `[附件:uuid|kind|name]`（runtime-session-helpers.tsx parseAttachmentMarkers）
 *   对齐，同名附件可精确区分）；映射不命中的孤儿 token 原样保留（降级纯文本）。
 * - 历史解析：正文按行内引用模式拆 text/ref 段，供气泡渲染标签（task-06）。
 *
 * 纯函数零 React 依赖；token 与引用均为消息正文内文本协议，不动后端。
 */

/** 附件 id → 编辑态 token 文本（【name】/【name·2】）映射（组件持有并回传父级）。 */
export type AttRefTokenMap = Record<string, string>;

/**
 * 构建编辑态 token：seq=1 无后缀，seq>1 加 `·seq`（同名唯一化，D-002）。
 */
export function buildAttRefToken(name: string, seq: number): string {
  return seq > 1 ? `【${name}·${seq}】` : `【${name}】`;
}

/**
 * 唯一化分配 token：existingTokens（调用方传"正文已出现 token + 已分配映射"并集——
 * 并集口径同时防住文件名自带 `·N` 的构造性碰撞：任何已被占用的文本都跳过）中按
 * 名字取最小可用序号。不随删除重排：分配后序号即固定，剥离不回收重用。
 */
export function allocateAttRefToken(name: string, existingTokens: string[]): string {
  const used = new Set(existingTokens);
  let seq = 1;
  while (used.has(buildAttRefToken(name, seq))) seq += 1;
  return buildAttRefToken(name, seq);
}

/**
 * 从 value 中移除 tokens 的全部出现（删附件联动清引用，FR-05/D-004）。
 * 逐 token 全量替换；不在 value 中的 token 无操作。
 */
export function stripAttRefTokens(value: string, tokens: string[]): string {
  let next = value;
  for (const token of tokens) {
    if (!token) continue;
    next = next.split(token).join("");
  }
  return next;
}

/**
 * 发送置换（FR-04/D-003）：tokenMap 命中且附件在列表中的 token →
 * `[附件引用:<uuid>|<name>]`；附件已删（孤儿 token）原样保留；token 已被用户
 * 手动删改则无出现无操作。tokenMap 空 → 原样返回（零开销旁路）。
 */
export function substituteAttRefsForSend(
  value: string,
  tokenMap: AttRefTokenMap,
  attachments: readonly { id: string; name: string }[],
): string {
  let next = value;
  const byId = new Map(attachments.map((a) => [a.id, a]));
  for (const [attId, token] of Object.entries(tokenMap)) {
    const att = byId.get(attId);
    if (!att || !token || !next.includes(token)) continue;
    next = next.split(token).join(`[附件引用:${att.id}|${att.name}]`);
  }
  return next;
}

/** 历史解析产物段：text 段原文 / ref 携带附件 id 与显示名（task-06 气泡渲染消费）。 */
export interface InlineAttRefPart {
  type: "text" | "ref";
  /** text 段原文 / ref 段文件名。 */
  value: string;
  /** 仅 ref 段携带。 */
  ref?: { id: string; name: string };
}

/**
 * 行内附件引用模式：uuid 36 位含连字符 hex，口径对齐 parseAttachmentMarkers 的
 * markerRe/uuidRe 双重校验（runtime-session-helpers.tsx）；name 段不含换行与 `]`
 * （防跨行贪婪匹配）。
 */
const INLINE_ATT_REF_RE =
  /\[附件引用:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\|([^\]\n]+)\]/g;

/**
 * 历史正文解析（FR-06/D-005）：按行内引用拆 text/ref 段；非法片段（uuid 形态
 * 不符等）归入 text 段原样保留（容错，不丢字）。
 * 2026-10-10-workspace-ref-intake task-01 起为 parseInlineRefs 的兼容薄封装
 * （仅投影附件段），既有消费零改动。
 */
export function parseInlineAttRefs(text: string): InlineAttRefPart[] {
  const parts: InlineAttRefPart[] = [];
  for (const p of parseInlineRefs(text)) {
    if (p.type === "text") {
      parts.push({ type: "text", value: p.value });
    } else if (p.ref?.kind === "att") {
      parts.push({ type: "ref", value: p.value, ref: { id: p.ref.id!, name: p.ref.name } });
    } else {
      // 工作区三类标记对旧消费方不存在（本变更前历史消息无此类标记）——
      // 按普通文本透传（raw 保留原始标记字面），保证段拼接逐字还原。
      parts.push({ type: "text", value: p.raw ?? p.value });
    }
  }
  return parts;
}

// ── 工作区引用（2026-10-10-workspace-ref-intake task-01，FR-02/06/07 数据面）──

/** 工作区引用三类：文件 / 目录 / 代码块（选中行范围）。 */
export type WsRefKind = "file" | "dir" | "code";

/**
 * 工作区引用描述符：工作区 id + 相对根 POSIX 路径锚定（explorer 寻址坐标，
 * frontend/src/lib/explorer.ts）。目录引用根 path 为空串、name 为「工作区根」；
 * kind=code 必填 lines（1 起始，含端点）。
 */
export interface WsRefDesc {
  kind: WsRefKind;
  workspaceId: string;
  /** 相对工作区根 POSIX 路径；目录引用根为 ""。 */
  path: string;
  /** 显示名（路径末段；根目录 = "工作区根"）。 */
  name: string;
  /** kind=code 必填：[起始行, 结束行]，1 起始含端点。 */
  lines?: [number, number];
}

/** 工作区引用条目（key 约定见 wsRefMapKey）。 */
export type WsRefTokenEntry = { desc: WsRefDesc; token: string };
export type WsRefTokenMap = Record<string, WsRefTokenEntry>;

/**
 * map 键约定：file/dir = path；code = `${path}:${起}-${止}`（同 path 不同行段
 * 是不同引用；key 由输入区分配与组装位置换两处共用，禁散拼字符串）。
 */
export function wsRefMapKey(desc: WsRefDesc): string {
  return desc.lines ? `${desc.path}:${desc.lines[0]}-${desc.lines[1]}` : desc.path;
}

/**
 * 工作区引用 token：基名 = name(+`:起-止`，无 L 前缀，D-005「完整显示基名」)，
 * seq>1 加 `·seq`——与附件 token 同形态（【design.md】/【design.md:10-16】/【a·2】），
 * 两池可共处一个并集序号池。
 */
export function buildWsRefToken(
  name: string,
  lines: [number, number] | undefined,
  seq: number,
): string {
  return buildAttRefToken(lines ? `${name}:${lines[0]}-${lines[1]}` : name, seq);
}

/**
 * 唯一化分配（D-005）：poolTokens = 附件 token ∪ 工作区 token（∪ 正文 inText
 * 保守占位，由调用方组并集）内按完整显示基名取最小可用序号；不随删除重排。
 * 与 allocateAttRefToken 同构（基名整体参与占位判定），直接委托（D-009 复用）。
 */
export function allocateWsRefToken(base: string, poolTokens: string[]): string {
  return allocateAttRefToken(base, poolTokens);
}

/**
 * 从 value 中移除 tokens 全部出现（清工作区引用 / 发送后清空用）；逐 token
 * 全量替换，与 stripAttRefTokens 同构（附件/工作区各用各的 token 集，删除
 * 精确匹配自身不互扰——D-005 组合推演）。
 */
export function stripWsRefTokens(value: string, tokens: string[]): string {
  return stripAttRefTokens(value, tokens);
}

/** 工作区引用发送态标记（D-003/D-004：指向语义，只含 wid+path+行号）。 */
function wsRefSendMarker(desc: WsRefDesc): string {
  if (desc.kind === "code" && desc.lines) {
    return `[代码引用:${desc.workspaceId}|${desc.path}|L${desc.lines[0]}-L${desc.lines[1]}]`;
  }
  return `[${desc.kind === "dir" ? "目录引用" : "文件引用"}:${desc.workspaceId}|${desc.path}]`;
}

/**
 * 发送置换（FR-06）：map 命中且正文出现的 token → 三类正式标记；孤儿 token
 * （map 不命中/用户手改坏）原样保留（降级纯文本，与附件 R-03 同口径）；map 空
 * → 原样返回（零开销旁路，未插入引用零行为差异）。
 */
export function substituteWsRefsForSend(value: string, map: WsRefTokenMap): string {
  let next = value;
  for (const { desc, token } of Object.values(map)) {
    if (!token || !next.includes(token)) continue;
    next = next.split(token).join(wsRefSendMarker(desc));
  }
  return next;
}

/** 统一历史解析产物段：附件 ref 带 id；工作区三类带 workspaceId/path(/lines)。 */
export interface InlineRefPart {
  type: "text" | "ref";
  /** text 段原文 / ref 段显示名。 */
  value: string;
  /** 仅 ref 段携带：原始标记字面（兼容投影/调试还原用）。 */
  raw?: string;
  /** 仅 ref 段携带。 */
  ref?: {
    kind: "att" | WsRefKind;
    /** kind=att：附件 uuid。 */
    id?: string;
    /** 工作区三类：工作区 id。 */
    workspaceId?: string;
    /** 工作区三类：相对根 POSIX 路径（目录引用根为 ""）。 */
    path?: string;
    /** kind=code：[起始行, 结束行]（1 起始含端点）。 */
    lines?: [number, number];
    /** 显示名：附件=上传名；工作区=路径末段（根 = "工作区根"）。 */
    name: string;
  };
}

/** uuid 36 位（附件既有口径，工作区 id 同为 uuid 锚）。 */
const REF_UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/**
 * 工作区三类标记：path 段**不含** `]` `|` 与换行——路径含竖线或右方括号时整段
 * 匹配失败降级为纯文本（审查 X-5 声明边界，与孤儿降级同口径）；目录空 path
 * （`[目录引用:wid|]` 空尾段）显式容忍；代码行段 `L起-L止`（1 起始）。
 * path 用非贪婪 + 行段可选拆三段：`[代码引用:wid|a.py|L1-L2]` 的 path 不会
 * 吞行段；行段非法（如 `L1-L2x`）整段回溯失配归 text。
 */
const INLINE_WS_REF_RE = new RegExp(
  "\\[(文件引用|目录引用|代码引用):(" + REF_UUID + ")\\|([^\\]|\\r\\n]*?)(?:\\|L(\\d+)-L(\\d+))?\\]",
  "g",
);

/** 工作区 path → 显示名（末段；根 = "工作区根"）。 */
function wsRefDisplayName(path: string): string {
  const segs = path.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1]! : "工作区根";
}

/**
 * 统一历史解析（FR-07）：附件 + 工作区三类标记拆 text/ref 段。附件段沿用
 * INLINE_ATT_REF_RE 独立口径（name 允许 `|`，兼容既有消息不回归）；工作区三类
 * 走 INLINE_WS_REF_RE（path 禁 `|`/`]`）。非法片段归 text 段原样保留（容错，
 * 不丢字）。
 */
export function parseInlineRefs(text: string): InlineRefPart[] {
  type Hit = { start: number; end: number; part: InlineRefPart };
  const hits: Hit[] = [];
  for (const m of text.matchAll(INLINE_ATT_REF_RE)) {
    hits.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      part: {
        type: "ref",
        value: m[2] ?? "",
        raw: m[0],
        ref: { kind: "att", id: m[1] ?? "", name: m[2] ?? "" },
      },
    });
  }
  for (const m of text.matchAll(INLINE_WS_REF_RE)) {
    // 捕获组 1 是中文标记字面，映射到 WsRefKind 枚举。
    const kind: WsRefKind =
      m[1] === "文件引用" ? "file" : m[1] === "目录引用" ? "dir" : "code";
    const workspaceId = m[2] ?? "";
    const path = m[3] ?? "";
    const name = wsRefDisplayName(path);
    const ref: NonNullable<InlineRefPart["ref"]> = { kind, workspaceId, path, name };
    if (kind === "code") {
      if (m[4] === undefined || m[5] === undefined) continue; // 防御：code 必有行段
      const l0 = Number(m[4]);
      const l1 = Number(m[5]);
      if (l0 < 1 || l1 < l0) continue; // 非法行段（0 起 / 倒序）整段降级 text
      ref.lines = [l0, l1];
      ref.name = linesSuffix(name, [l0, l1]);
    }
    hits.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, part: { type: "ref", value: ref.name, raw: m[0], ref } });
  }
  hits.sort((a, b) => a.start - b.start);
  const parts: InlineRefPart[] = [];
  let last = 0;
  for (const hit of hits) {
    if (hit.start > last) parts.push({ type: "text", value: text.slice(last, hit.start) });
    parts.push(hit.part);
    last = hit.end;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

/** 代码引用显示名（末段 + 行号段，无 L 前缀，与编辑态 token 基名一致）。 */
function linesSuffix(name: string, lines: [number, number]): string {
  return `${name}:${lines[0]}-${lines[1]}`;
}
