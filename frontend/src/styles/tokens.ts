/**
 * Design Token 单一源 (task-01 / FR-01 / D-005@v1 / D-006@v1)
 *
 * - TS 常量 `tokens`:供 antd 等运行时消费方以 hex 形式取色 (tokens.color.*)
 * - CSS 变量字符串 `cssVars`:供 globals.css 注入 :root,Tailwind 侧以 var(--color-*) 消费
 * - breakpoint 段供移动端判定 (FR-09 / task-02):逻辑阈值常量,非视觉值,不注入 cssVars
 *
 * 色阶严格采用 Tailwind v3 默认值,禁止自行调色。
 * 新增颜色必须经本文件入口 (边界 #5)。
 */

export const tokens = {
  color: {
    primary: '#2563EB',

    blue: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
      950: '#1e3a8a',
    },

    cyan: '#06b6d4',
    emerald: '#10b981',

    slate: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
    },

    // 背景层
    bg: '#f8fafc',
    card: '#ffffff',
    border: '#e2e8f0',

    // 状态语义 (5 种 kind,暗色扩展靠语义键名,本任务不输出 .dark)
    semantic: {
      success: { kind: 'success', color: '#10b981' },
      warning: { kind: 'warning', color: '#f59e0b' },
      error: { kind: 'error', color: '#ef4444' },
      info: { kind: 'info', color: '#2563eb' },
      neutral: { kind: 'neutral', color: '#64748b' },
    },
  },

  // px 数值,消费方按需转 rem
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
  },

  // 柔和阴影 (rgba 低透明)
  shadow: {
    sm: '0 1px 2px 0 rgba(15, 23, 42, 0.05)',
    md: '0 2px 8px -1px rgba(15, 23, 42, 0.08), 0 1px 3px 0 rgba(15, 23, 42, 0.04)',
    lg: '0 8px 24px -4px rgba(15, 23, 42, 0.10), 0 4px 8px -2px rgba(15, 23, 42, 0.05)',
  },

  font: {
    sans: 'Inter, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  },

  // 基于 4px 基础单位 (spacing[1]=4 起)
  spacing: {
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48,
    16: 64,
    20: 80,
    24: 96,
  },

  // 移动端断点阈值 (px,D-005:仅手机 ≤768px;平板 >768 走桌面)
  // 逻辑阈值常量,供移动组件 matchMedia / 响应式判定引用 (FR-09),不注入 cssVars
  breakpoint: {
    mobile: 768,
  },
} as const;

/**
 * CSS 变量字符串,供 globals.css `:root { ${cssVars} }` 注入。
 * 仅 --color-* 命名空间;HSL 变量迁移由 task-04 负责。
 */
export const cssVars = `  --color-primary: #2563EB;
  --color-cyan: #06b6d4;
  --color-emerald: #10b981;
  --color-blue-50: #eff6ff;
  --color-blue-100: #dbeafe;
  --color-blue-200: #bfdbfe;
  --color-blue-300: #93c5fd;
  --color-blue-400: #60a5fa;
  --color-blue-500: #3b82f6;
  --color-blue-600: #2563eb;
  --color-blue-700: #1d4ed8;
  --color-blue-800: #1e40af;
  --color-blue-900: #1e3a8a;
  --color-blue-950: #1e3a8a;
  --color-slate-50: #f8fafc;
  --color-slate-100: #f1f5f9;
  --color-slate-200: #e2e8f0;
  --color-slate-300: #cbd5e1;
  --color-slate-400: #94a3b8;
  --color-slate-500: #64748b;
  --color-slate-600: #475569;
  --color-slate-700: #334155;
  --color-slate-800: #1e293b;
  --color-slate-900: #0f172a;
  --color-bg: #f8fafc;
  --color-card: #ffffff;
  --color-border: #e2e8f0;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #2563eb;
  --color-neutral: #64748b;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --shadow-sm: ${tokens.shadow.sm};
  --shadow-md: ${tokens.shadow.md};
  --shadow-lg: ${tokens.shadow.lg};
  --font-sans: ${tokens.font.sans};
  --spacing-base: 4px;`;
