"use client";

/**
 * 思考内容离线翻译共享渲染层（2026-10-19-thinking-zh-translate / FR-01·FR-04）。
 *
 * 三条思考渲染路径（daemon 会话面板 ThinkingRowView / TurnDetailsList、
 * AgentLogViewer、agent-logs 回放卡）统一接入本文件，禁止各自拷贝逻辑：
 *
 * - ``useThinkingTranslation``：译文状态机（off/original/translating/translated/
 *   unavailable）。流式中（streaming=true）不请求显示原文；streaming 缺省（静态
 *   回放/无标记路径）时文本稳定 1.2s 才送翻（防增长中正文重复请求）；译文
 *   到达前先显示原文避免布局跳变；「显示原文」为组件本地切换不写全局偏好。
 * - ``useThinkingSummary``：折叠摘要——压平取前 500 字符（头部早稳定，一次
 *   请求终身缓存命中）送翻，译文压平截 60 字符展示；流式中显示原文摘要。
 * - ``TranslatedThinkingBody``：正文渲染组件（markdown / plain 双形态）+
 *   右上角状态行（翻译中脉冲 / 未就绪一次性提示 / 原文↔译文切换）。
 */
import { useEffect, useState } from "react";

import { MarkdownText } from "@/components/ui/markdown-text";
import { isTranslationUnavailable, needsTranslation, translateText } from "@/lib/thinking-translate";
import { cn } from "@/lib/utils";
import { useThinkingTranslateStore } from "@/stores/thinking-translate";

/** 折叠摘要送翻的前缀长度（压平后）。 */
const SUMMARY_PREFIX_CHARS = 500;
/** 句界吸附回看窗口：前缀截断点向前找最近句界的范围。 */
const SUMMARY_SENTENCE_LOOKBACK = 120;
/** streaming 缺省路径的文本稳定窗口（ms）。 */
const STABLE_WINDOW_MS = 1200;

/**
 * 摘要送翻前缀（design 承诺「截断到最近句界」——2026-10-19 评审 P2 修复）：
 * 超 500 字符时在尾部回看窗内吸附最近句末标点（中英文句界），避免半句送翻
 * 产出残缺译文；回看窗内无句界则保持硬截断（极罕见，预览语义可接受）。
 */
function summaryPrefix(flat: string): string {
  if (flat.length <= SUMMARY_PREFIX_CHARS) return flat;
  const lookback = flat.slice(
    Math.max(0, SUMMARY_PREFIX_CHARS - SUMMARY_SENTENCE_LOOKBACK),
    SUMMARY_PREFIX_CHARS,
  );
  const lastStop = Math.max(
    lookback.lastIndexOf("."),
    lookback.lastIndexOf("!"),
    lookback.lastIndexOf("?"),
    lookback.lastIndexOf("。"),
    lookback.lastIndexOf("！"),
    lookback.lastIndexOf("？"),
  );
  if (lastStop >= 0) {
    return flat.slice(0, SUMMARY_PREFIX_CHARS - SUMMARY_SENTENCE_LOOKBACK + lastStop + 1);
  }
  return flat.slice(0, SUMMARY_PREFIX_CHARS);
}

export type ThinkingTranslationState =
  | "off" // 偏好关闭/不值得翻/流式中——原样展示且零请求
  | "translating"
  | "translated"
  | "unavailable"; // 引擎不可用/网络失败——原文 + 一次性轻提示

export interface UseThinkingTranslationResult {
  /** 该展示的文本（原文或译文——译文未就绪时恒为原文，无布局跳变）。 */
  displayText: string;
  state: ThinkingTranslationState;
  /** 当前是否处于「用户切回原文」视图（仅 translated 态有意义）。 */
  showOriginal: boolean;
  toggleOriginal: () => void;
}

/**
 * 单条思考文本的翻译状态机（摘要/正文共用；分块/合批/缓存归
 * lib/thinking-translate，本 hook 只管订阅与展示态）。
 */
export function useThinkingTranslation(
  text: string,
  opts: { streaming?: boolean; enabled?: boolean } = {},
): UseThinkingTranslationResult {
  const prefEnabled = useThinkingTranslateStore((s) => s.enabled);
  const [translated, setTranslated] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  // streaming 缺省路径：文本稳定窗口后的值才作为送翻输入（增长中正文防抖）；
  // 展示源恒为最新 text——译文只在恰好对应当前文本时切入，避免显示陈旧内容
  const [stableText, setStableText] = useState(text);

  const streaming = opts.streaming ?? null;
  useEffect(() => {
    if (streaming !== null) return; // 显式 streaming 标记优先，跳过防抖
    const timer = setTimeout(() => setStableText(text), STABLE_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [text, streaming]);

  const translationInput = streaming === null ? stableText : text;
  const active =
    prefEnabled && opts.enabled !== false && !streaming && needsTranslation(translationInput);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setFailed(false);
    translateText(translationInput).then((result) => {
      if (cancelled) return;
      if (result === null) setFailed(true);
      else setTranslated(result);
    });
    return () => {
      cancelled = true;
    };
  }, [active, translationInput]);

  const noOp = () => {};
  if (!active) {
    return { displayText: text, state: "off", showOriginal: false, toggleOriginal: noOp };
  }
  if (translated !== null && text === translationInput) {
    return {
      displayText: showOriginal ? text : translated,
      state: "translated",
      showOriginal,
      toggleOriginal: () => setShowOriginal((v) => !v),
    };
  }
  return {
    displayText: text,
    state: failed && isTranslationUnavailable() ? "unavailable" : "translating",
    showOriginal: false,
    toggleOriginal: noOp,
  };
}

/** 折叠摘要：前 500 字符（句界吸附）送翻 → 译文压平截 60 字符（+“…”）。 */
export function useThinkingSummary(text: string, streaming?: boolean): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const prefix = summaryPrefix(flat);
  const { displayText } = useThinkingTranslation(prefix, { streaming });
  const displayFlat = displayText.replace(/\s+/g, " ").trim();
  return displayFlat.length > 60 ? `${displayFlat.slice(0, 60)}…` : displayFlat;
}

/**
 * 思考正文翻译渲染体：状态行（翻译中/未就绪/原文切换）+ markdown 或纯文本。
 * 调用方保留自己的容器样式与折叠逻辑，把原先直接渲染 ``text`` 的位置换成
 * 本组件即可。
 */
export function TranslatedThinkingBody({
  text,
  streaming,
  variant = "markdown",
  className,
}: {
  text: string;
  streaming?: boolean;
  /** markdown：MarkdownText 渲染（会话面板/时间线/回放卡）；plain：whitespace-pre-wrap（AgentLogViewer）。 */
  variant?: "markdown" | "plain";
  className?: string;
}) {
  const { displayText, state, showOriginal, toggleOriginal } = useThinkingTranslation(text, {
    streaming,
  });
  const showMetaRow = state === "translating" || state === "unavailable" || state === "translated";
  return (
    <div className="relative w-full">
      {showMetaRow && (
        <div className="mb-1 flex items-center justify-end gap-2 text-[10px] text-muted-foreground/70">
          {state === "translating" && (
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="h-[4px] w-[4px] animate-pulse rounded-full bg-brand-600"
              />
              翻译中…
            </span>
          )}
          {state === "unavailable" && (
            <span title="后端离线翻译模型未就绪（或网络失败），已回退显示原文">
              🌐 离线翻译未就绪
            </span>
          )}
          {state === "translated" && (
            <button
              type="button"
              onClick={toggleOriginal}
              className="cursor-pointer rounded px-1 py-[1px] hover:bg-muted"
            >
              {showOriginal ? "显示译文" : "显示原文"}
            </button>
          )}
        </div>
      )}
      {variant === "markdown" ? (
        <MarkdownText content={displayText} />
      ) : (
        <div className={cn("whitespace-pre-wrap break-words", className)}>{displayText}</div>
      )}
    </div>
  );
}
