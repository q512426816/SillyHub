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
 */
export function parseInlineAttRefs(text: string): InlineAttRefPart[] {
  const parts: InlineAttRefPart[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_ATT_REF_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ type: "text", value: text.slice(last, idx) });
    parts.push({ type: "ref", value: m[2] ?? "", ref: { id: m[1] ?? "", name: m[2] ?? "" } });
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}
