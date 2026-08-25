import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      colors: {
        // ---- shadcn 语义色(hsl var,保留全部现有 key,只增不删) ----
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },

        // ---- 状态语义(与 tokens.semantic 对齐,DEFAULT 走 hsl var,
        //      bg-success/text-warning/bg-error/text-info 可直接用) ----
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        error: {
          DEFAULT: "hsl(var(--error))",
          foreground: "hsl(var(--error-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },

        // ---- brand 语义色阶(主题感知:50-950 十一档纯 CSS 变量名映射,无硬编码 hex;
        //      双套取值由 globals.css 的 :root / [data-theme="blue"] 变量块提供(task-02),
        //      bg-brand-50 等类随 html data-theme 切换自动换肤,D-003@v2;
        //      blue 阶保留为真实信息色与非 brand 场景用途) ----
        // 函数形式(协调修正,task-12 发现):Tailwind 3 对 var() 颜色的 /alpha 修饰符
        // 静默失效(bg-brand-100/60 不生成 CSS),函数分支用 color-mix 补齐透明度语义。
        // 透明度入参三种形态:数字(0.6)→百分比;var(--tw-*-opacity) 字符串(无修饰符类)
        // →calc 包裹换算百分比(color-mix 只吃 <percentage>,裸数字/var 均非法);
        // undefined(不经 withAlphaVariable 的调用方)→退回纯 var()。
        brand: Object.fromEntries(
          (
            [
              "50",
              "100",
              "200",
              "300",
              "400",
              "500",
              "600",
              "700",
              "800",
              "900",
              "950",
            ] as const
          ).map((step) => [
            step,
            ({ opacityValue }: { opacityValue?: number | string }) => {
              if (opacityValue === undefined) {
                return `var(--color-brand-${step})`;
              }
              const pct =
                typeof opacityValue === "number"
                  ? `${opacityValue * 100}%`
                  : `calc(${opacityValue} * 100%)`;
              return `color-mix(in srgb, var(--color-brand-${step}) ${pct}, transparent)`;
            },
          ])
        ),

        // ---- 基础调色板·真实信息色(直接 hex,与 tokens.color.palette 对齐,
        //      不走 CSS 变量;blue 阶仅限真信息蓝/外部标识色场景;
        //      slate 中性阶已变量化,例外见下方) ----
        blue: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#1e3a8a",
        },
        cyan: {
          DEFAULT: "#06b6d4",
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
          800: "#155e75",
          900: "#164e63",
        },
        emerald: {
          DEFAULT: "#10b981",
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
        },
        // ---- slate 中性阶(主题感知:50-900 十档纯 CSS 变量名映射,无硬编码 hex;
        //      取值由 globals.css 的 :root / [data-theme="blue"] / [data-theme="dark"]
        //      变量块提供(本变更 task-02),bg-slate-100 等类随 html data-theme 切换
        //      自动换肤(dark 为 50↔900 对称翻转);浅色两主题取值与 Tailwind 默认
        //      hex 逐值相等,观感零变化,D-005@v1;
        //      函数映射与上方 brand 阶同构:/alpha 修饰符经 color-mix 补齐透明度语义
        //      (透明度入参三形态说明见 brand 段注释) ----
        slate: Object.fromEntries(
          (
            [
              "50",
              "100",
              "200",
              "300",
              "400",
              "500",
              "600",
              "700",
              "800",
              "900",
            ] as const
          ).map((step) => [
            step,
            ({ opacityValue }: { opacityValue?: number | string }) => {
              if (opacityValue === undefined) {
                return `var(--color-slate-${step})`;
              }
              const pct =
                typeof opacityValue === "number"
                  ? `${opacityValue * 100}%`
                  : `calc(${opacityValue} * 100%)`;
              return `color-mix(in srgb, var(--color-slate-${step}) ${pct}, transparent)`;
            },
          ])
        ),
      },
      fontFamily: {
        // 通过 var(--font-inter) 接入 task-02 next/font 注入的 Inter,
        // 中文降级到 PingFang SC / Microsoft YaHei
        sans: [
          "var(--font-inter)",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
      boxShadow: {
        // ql-20260820-009 阴影主题化:走 CSS 变量(globals.css 双套,紫调/blue 旧灰调),
        // shadow-* 类随 html data-theme 切换;与 brand 阶同款 var 模式
        xs: "var(--shadow-sm)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        primary: "var(--shadow-primary)",
      },
      borderRadius: {
        // 补 xs;其余对齐 tokens.radius(sm/md/lg/xl)
        xs: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 2px)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      animation: {
        // 命名加 sh- 前缀,避免与 tailwindcss-animate 内置(fade-in-down/up 等)冲突
        "fade-in": "sh-fade-in 200ms ease-out",
        "slide-up": "sh-slide-up 240ms ease-out",
        "scale-in": "sh-scale-in 180ms ease-out",
        // 悬浮会话球（2026-08-25 悬浮球拖拽/收起增强）：辉光环慢旋 + 待机呼吸浮动
        "spin-slower": "sh-spin-slower 5s linear infinite",
        float: "sh-float 3.2s ease-in-out infinite",
      },
      keyframes: {
        "sh-fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "sh-slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "sh-scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "sh-spin-slower": {
          to: { transform: "rotate(360deg)" },
        },
        "sh-float": {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
