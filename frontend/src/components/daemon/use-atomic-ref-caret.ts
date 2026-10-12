"use client";

/**
 * 引用标签原子性光标拦截（2026-10-12-ws-ref-atomic-caret）。
 *
 * textarea 纯文本方案下 token 就是普通文本（D-001 架构），光标天然能进入标签
 * 内部逐字符移动/改字——本 hook 在不动编辑器架构的前提下补「整体感」三拦截：
 * - 方向键跳块：无选区时 ←/→ 在标签区间边界一次跨过整块（贴尾 ← 到块头、
 *   贴头 → 到块尾）；shift 扩展选区不拦（选区可跨块，配合部分重叠拒绝兜底）。
 * - 点击/落位吸附：click / keyup / select 后光标无选区且落在标签内部 →
 *   吸附最近边界（前半去头、后半去尾）；Home/End/Ctrl+方向落入内部由此兜底。
 * - 内部编辑拒绝：beforeinput 的目标 range 与任一标签部分重叠（交集非空且
 *   未完整覆盖该标签）→ preventDefault——打字/删字/IME 组字/粘贴均拒；
 *   选区完整覆盖整块放行（随选区整块删除）。
 *
 * 退格贴尾整删与 × 角标删除在宿主既有处理器（本 hook 不触碰）；发送置换/
 * 联想检测零关联。幂等：吸附仅在位置实际改变时 setSelectionRange（防 select
 * 事件回环）。
 */

import { useMemo, type EventHandler, type KeyboardEvent, type FormEvent } from "react";

/** token 在 value 中的一次出现区间（字符 index，[start, end)）。 */
export interface RefTokenRange {
  start: number;
  end: number;
  token: string;
}

/** 全部 token 的全部出现区间（长 token 优先匹配已由 tokens 顺序无关的 indexOf 循环保证逐个计入）。 */
export function computeRefTokenRanges(value: string, tokens: string[]): RefTokenRange[] {
  const ranges: RefTokenRange[] = [];
  for (const token of tokens) {
    if (!token) continue;
    let from = 0;
    for (;;) {
      const idx = value.indexOf(token, from);
      if (idx < 0) break;
      ranges.push({ start: idx, end: idx + token.length, token });
      from = idx + token.length;
    }
  }
  return ranges;
}

/** 光标 p 是否落在某标签内部（不含两端边界）。 */
function insideRange(p: number, r: RefTokenRange): boolean {
  return p > r.start && p < r.end;
}

export interface UseAtomicRefCaretOptions {
  /** 输入框当前值（受控，与 textarea 同源）。 */
  value: string;
  /** 原子化 token 全集（附件 ∪ 工作区两池）。 */
  tokens: string[];
  /** textarea ref（吸附 setSelectionRange 用）。 */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useAtomicRefCaret({ value, tokens, textareaRef }: UseAtomicRefCaretOptions) {
  const ranges = useMemo(() => computeRefTokenRanges(value, tokens), [value, tokens]);

  /** 方向键跳块：命中（已 preventDefault + 复位光标）返回 true，宿主应即刻 return。 */
  const handleAtomicKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
    if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.nativeEvent.isComposing) return false; // IME 组合期不劫持（评审 P3-1，单/群聊统一）
    const ta = e.currentTarget;
    if (ta.selectionStart !== ta.selectionEnd) return false;
    const p = ta.selectionStart ?? 0;
    if (e.key === "ArrowLeft") {
      // 从右侧接近（贴尾或内部）→ 跳到块头。
      const hit = ranges.find((r) => p > r.start && p <= r.end);
      if (hit) {
        e.preventDefault();
        ta.setSelectionRange(hit.start, hit.start);
        return true;
      }
    } else {
      // 从左侧接近（贴头或内部）→ 跳到块尾。
      const hit = ranges.find((r) => p >= r.start && p < r.end);
      if (hit) {
        e.preventDefault();
        ta.setSelectionRange(hit.end, hit.end);
        return true;
      }
    }
    return false;
  };

  /** 内部编辑拒绝（beforeinput）。 */
  const handleAtomicBeforeInput: EventHandler<FormEvent<HTMLTextAreaElement>> = (e) => {
    const input = e.nativeEvent as InputEvent;
    const targetRanges =
      typeof input.getTargetRanges === "function" ? input.getTargetRanges() : [];
    const range = targetRanges[0];
    if (!range) return; // 无目标区间（如全量 setRangeText）不拦
    const rs = range.startOffset;
    const re = range.endOffset;
    for (const r of ranges) {
      // 交集非空 = 部分触碰；完整覆盖（rs<=start && re>=end）放行整块删除。
      const overlaps = rs < r.end && re > r.start;
      const fullyCovers = rs <= r.start && re >= r.end;
      if (overlaps && !fullyCovers) {
        e.preventDefault();
        return;
      }
    }
  };

  /** 落位吸附（click/keyup/select 后）：无选区且在内部 → 最近边界。幂等。 */
  const snapCaret = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (ta.selectionStart !== ta.selectionEnd) return;
    const p = ta.selectionStart ?? 0;
    const hit = ranges.find((r) => insideRange(p, r));
    if (!hit) return;
    const to = p - hit.start <= hit.end - p ? hit.start : hit.end;
    ta.setSelectionRange(to, to);
  };

  return { ranges, handleAtomicKeyDown, handleAtomicBeforeInput, snapCaret };
}
