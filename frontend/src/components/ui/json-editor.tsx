"use client";

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type UIEvent,
} from "react";
import { ChevronsUpDown, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface JsonEditorProps {
  /** 当前 JSON 文本（受控）。 */
  value: string;
  /** 文本变化回调；JSON 非法期间也会回调，绝不丢用户输入。 */
  onChange: (value: string) => void;
  /** 空内容时的占位提示。 */
  placeholder?: string;
  /** 可视高度行数，默认 12。 */
  rows?: number;
}

/**
 * 自研轻量 JSON 编辑器（变更 2026-07-27-llm-provider-fetch-models / spike-03）。
 *
 * 不引 CodeMirror：cc-switch 的 JsonEditor 重依赖 codemirror + 6 个 @codemirror/*
 * 包，会拖慢前端构建。本组件用 textarea + 行号 gutter + 「格式化」+「折叠」实现
 * 等价可用集，零重依赖、纯受控（value / onChange）。
 *
 * 容错铁律：JSON 非法不崩——
 *   - 「格式化」try/catch 静默（错误已由实时校验行内提示，不抛错、不丢输入）；
 *   - 实时校验 useMemo try JSON.parse，失败在工具栏右侧红字提示，合法/空则不提示。
 *
 * 行号 gutter 与 textarea 共享 fontSize/lineHeight/padding，通过 onScroll 同步
 * scrollTop 实现滚动联动（轻量方案，对齐 spike-03 决策）。
 */
export function JsonEditor({
  value,
  onChange,
  placeholder = "",
  rows = 12,
}: JsonEditorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const gutterRef = useRef<HTMLPreElement>(null);

  // 行号 = 换行分割段数；空串按 1 行兜底，gutter 永远至少显示一行。
  const lineNumbers = useMemo(() => {
    const count = value === "" ? 1 : value.split("\n").length;
    return Array.from({ length: count }, (_, i) => i + 1).join("\n");
  }, [value]);

  // 实时校验：空串视为合法；JSON.parse 失败收集 message，不崩。
  const validation = useMemo<{ ok: boolean; msg: string | null }>(() => {
    if (!value.trim()) return { ok: true, msg: null };
    try {
      JSON.parse(value);
      return { ok: true, msg: null };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  }, [value]);

  /** 「格式化」：JSON.parse → stringify(null, 2)；空串或非法静默不崩。 */
  const handleFormat = (): void => {
    if (!value.trim()) return;
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
    } catch {
      // 非法 JSON：实时校验已行内提示，这里静默不崩。
    }
  };

  /** textarea 滚动联动行号 gutter（gutter overflow-hidden，程序设 scrollTop 生效）。 */
  const handleScroll = (e: UIEvent<HTMLTextAreaElement>): void => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  return (
    <div className="rounded border border-input bg-background">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-input/60 px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={handleFormat}
        >
          <Wand2 className="mr-1 h-3 w-3" />
          格式化
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="json-editor-body"
        >
          <ChevronsUpDown className="mr-1 h-3 w-3" />
          {collapsed ? "展开" : "折叠"}
        </Button>
        <span
          role={validation.ok ? undefined : "alert"}
          className={
            validation.ok
              ? "ml-auto text-[11px] text-muted-foreground/70"
              : "ml-auto text-[11px] text-destructive"
          }
        >
          {validation.ok
            ? value.trim()
              ? "JSON 有效"
              : ""
            : `JSON 非法：${validation.msg}`}
        </span>
      </div>
      {!collapsed && (
        <div id="json-editor-body" className="flex items-stretch">
          <pre
            ref={gutterRef}
            aria-hidden="true"
            className="m-0 w-auto select-none overflow-hidden whitespace-pre border-r border-input/60 bg-muted/30 px-2 py-2 text-right font-mono text-[11px] leading-[1.5] text-muted-foreground"
          >
            {lineNumbers}
          </pre>
          <textarea
            value={value}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              onChange(e.target.value)
            }
            onScroll={handleScroll}
            spellCheck={false}
            rows={rows}
            placeholder={placeholder}
            aria-label="JSON 编辑器"
            className="flex-1 resize-y border-0 bg-background p-2 font-mono text-[11px] leading-[1.5] text-foreground focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

export default JsonEditor;
