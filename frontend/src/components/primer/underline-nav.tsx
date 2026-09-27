/**
 * UnderlineNav —— primer 下划线 tab（2026-09-26-core-pages-visual-redesign FR-01 / FR-03）。
 *
 * GitHub UnderlineNav 范式：文字 tab + 底部 2px 主题色指示条 + Counter 计数联动。
 * 受控组件（value/onChange）；指示条色走主题 token（铁律：原型的 #fd8c73 仅为
 * ai-native 参考值，落地用 --color-brand-600 随主题换肤）。
 * 键盘可达：tab 间用 roving tabindex，Enter/Space 经原生 button 激活当前项。
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
    // 2026-09-28-audit-risk-fixes：删除容器 onKeyDown——tab 是原生 <button>，
    // Enter/Space 原生激活已触发 onClick（当前项）；原容器级处理在冒泡段再调
    // onChange(下一项)，一次按键双触发且最终落在下一个 tab。键盘可达仍由
    // roving tabindex + 原生 button 激活承载。
    <div
      role="tablist"
      className={`flex items-center gap-1 border-b ${className ?? ""}`}
      style={{ borderBottomColor: "hsl(var(--border))" }}
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
            className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors duration-100 ${
              active ? "font-semibold" : "font-medium hover:bg-muted"
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
