/**
 * UnderlineNav —— primer 下划线 tab（2026-09-26-core-pages-visual-redesign FR-01 / FR-03）。
 *
 * GitHub UnderlineNav 范式：文字 tab + 底部 2px 主题色指示条 + Counter 计数联动。
 * 受控组件（value/onChange）；指示条色走主题 token（铁律：原型的 #fd8c73 仅为
 * ai-native 参考值，落地用 --color-brand-600 随主题换肤）。
 * 键盘可达：tab 间用 roving tabindex，Enter/Space 切换。
 */
import * as React from "react";

import { Counter } from "./counter";

export interface UnderlineNavItem<T extends string> {
  key: T;
  label: React.ReactNode;
  /** tab 计数（可选，渲染 Counter）。 */
  counter?: number;
}

export interface UnderlineNavProps<T extends string> {
  items: Array<UnderlineNavItem<T>>;
  /** 受控当前 key。 */
  value: T;
  /** 切换回调（过滤即时切换，计数实时刷新由调用方数据驱动）。 */
  onChange: (key: T) => void;
  className?: string;
}

export function UnderlineNav<T extends string>({
  items,
  value,
  onChange,
  className,
}: UnderlineNavProps<T>) {
  return (
    <div
      role="tablist"
      className={`flex items-center gap-1 border-b ${className ?? ""}`}
      style={{ borderBottomColor: "hsl(var(--border))" }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const idx = items.findIndex((item) => item.key === value);
        const next = items[(idx + 1) % items.length];
        if (next) {
          e.preventDefault();
          onChange(next.key);
        }
      }}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
              active ? "font-semibold" : "font-medium hover:bg-muted/60"
            }`}
            style={{
              color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
              borderBottomColor: active
                ? "var(--color-brand-600)"
                : "transparent",
            }}
          >
            {item.label}
            {typeof item.counter === "number" ? (
              <Counter count={item.counter} active={active} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
