/**
 * prototype-as-code 演示公共件 —— 演示条（主题切换 + 出身声明）。
 * 真实页面无此条，属原型产物 chrome；五个演示视图共用。
 */
import * as React from "react";

export function DemoBar() {
  const themeBtn =
    "rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-muted";
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground"
      style={{
        backgroundColor: "hsl(var(--muted))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <span>
        prototype-as-code 演示 · 本文件由真实 primer 组件 + Tailwind +
        themes.ts token 编译生成，数据为 fixture
      </span>
      <span className="flex items-center gap-1.5">
        {["ai-native", "blue", "dark"].map((t) => (
          <button
            key={t}
            type="button"
            data-theme-btn={t}
            className={themeBtn}
            style={{ borderColor: "hsl(var(--border))" }}
          >
            {t}
          </button>
        ))}
      </span>
    </div>
  );
}
