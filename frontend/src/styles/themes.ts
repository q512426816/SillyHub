/**
 * 主题注册表单一源 (task-01 / FR-01 / D-101@v1 / D-003@v2 / D-004@v1)
 *
 * - `themes`: blue(现版观感原样平移) / ai-native(默认,AI-Native 视觉) / dark(暗夜)
 *   三套完整取值,供 antd 等运行时消费方按当前主题取色 (themes[theme].color.*);
 *   globals.css CSS 变量块、theme store、antd 动态化、图表取色均以本文件为取值契约
 * - radius / shadow / font / spacing 不进 ThemeDef,留在 globals.css 消费侧
 *   (design §5 P0;原 tokens.ts 已于 task-08 删除)
 *
 * 色阶严格采用 Tailwind v3 默认值,禁止自行调色。
 * 新增颜色必须经本文件入口 (边界 #5,接替 tokens.ts 的 palette 入口职责)。
 * 例外 (D-003@v2): semantic.info 各主题统一取各自 accent 青,
 * blue 主题 info 不再是旧 tokens 的 #2563eb,保证状态语义跨主题一致 (design §9 例外声明)。
 * dark 取值 (变更 2026-08-23-frontend-dark-theme / D-004@v1): slate / brand 阶为
 * 浅色阶对称翻转 (slate 50↔900、100↔800、200↔700、300↔600、400↔500;
 * brand 50↔950、100↔900、200↔800、300↔700、400↔600、500 自映),
 * 主色与语义色较浅色主题提亮一档保证深底对比度,仍全部取 Tailwind v3 默认值
 * (design §5.1),DEFAULT_THEME 保持 ai-native 不变。
 */

export type ThemeName = 'blue' | 'ai-native' | 'dark';

/** 品牌色阶 50-950 十一档 (blue=Tailwind blue 阶 / ai-native=Tailwind violet 阶 / dark=violet 阶对称翻转) */
export type BrandScale = Record<
  '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950',
  string
>;

/** 主题取值集合:仅收录随主题变化的键,共享维度不在此 */
export interface ThemeColorDef {
  primary: string;
  primaryHover: string;
  accent: string;
  bg: string;
  card: string;
  border: string;
  brand: BrandScale;
  slate: Record<
    '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900',
    string
  >;
  semantic: {
    success: string;
    warning: string;
    error: string;
    info: string;
    neutral: string;
  };
}

export interface ThemeDef {
  name: ThemeName;
  label: string;
  color: ThemeColorDef;
}

/** 中性 slate 阶 (Tailwind v3 默认值,浅色两主题共用,同原 tokens.slate) */
const slate: ThemeColorDef['slate'] = {
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
};

/**
 * 暗色 slate 阶:浅色 slate 阶对称翻转 (D-004@v1,变更 2026-08-23-frontend-dark-theme)
 * 翻转映射 50↔900、100↔800、200↔700、300↔600、400↔500,深浅语义互换
 * (浅底变深底/深字变浅字),取值仍全部为 Tailwind v3 默认值,禁止自调。
 */
const darkSlate: ThemeColorDef['slate'] = {
  50: slate[900],
  100: slate[800],
  200: slate[700],
  300: slate[600],
  400: slate[500],
  500: slate[400],
  600: slate[300],
  700: slate[200],
  800: slate[100],
  900: slate[50],
};

const blueTheme: ThemeDef = {
  name: 'blue',
  label: '明亮蓝',
  color: {
    // 取值自 tokens.ts 原样平移;brand 950 档历史笔误(#1e3a8a 与 900 重复)
    // 已按 Tailwind v3 默认值修正为 #172554 (task-01 卡声明)
    primary: '#2563EB',
    primaryHover: '#1d4ed8',
    accent: '#06b6d4',
    bg: '#f8fafc',
    card: '#ffffff',
    border: '#e2e8f0',
    brand: {
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
      950: '#172554',
    },
    slate,
    // info 统一取 accent 青 (D-003@v2 例外声明,design §9)
    semantic: {
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#06b6d4',
      neutral: '#64748b',
    },
  },
};

const aiNativeTheme: ThemeDef = {
  name: 'ai-native',
  label: 'AI 紫',
  color: {
    // 取值对照原型 prototype-frontend-ai-native-style.html 的 :root 段
    primary: '#7C3AED', // AI 紫 (violet-600)
    primaryHover: '#6D28D9', // violet-700
    accent: '#0891B2', // 交互青
    bg: '#FAF5FF', // 淡紫页面底
    card: '#FFFFFF',
    border: '#DDD6FE', // violet-200 边框
    brand: {
      50: '#f5f3ff',
      100: '#ede9fe',
      200: '#ddd6fe',
      300: '#c4b5fd',
      400: '#a78bfa',
      500: '#8b5cf6',
      600: '#7c3aed',
      700: '#6d28d9',
      800: '#5b21b6',
      900: '#4c1d95',
      950: '#2e1065',
    },
    slate,
    // 按原型语义档 (info=accent 青,D-003@v2)
    semantic: {
      success: '#059669',
      warning: '#D97706',
      error: '#DC2626',
      info: '#0891B2',
      neutral: '#64748b',
    },
  },
};

/**
 * 暗夜主题 (变更 2026-08-23-frontend-dark-theme / D-004@v1 / design §5.1)
 * 取值策略:色阶对称翻转 (见文件头),主色与语义色较浅色主题提亮一档保证深底对比度;
 * 全部取值为 Tailwind v3 默认值,禁止自调。
 */
const darkTheme: ThemeDef = {
  name: 'dark',
  label: '暗夜',
  color: {
    primary: '#8b5cf6', // violet-500 (浅色主题 primary 为 violet-600,提亮一档)
    primaryHover: '#a78bfa', // violet-400
    accent: '#22d3ee', // cyan-400 (浅色主题 accent 为 cyan-600,提亮两档)
    bg: '#0f172a', // slate-900
    card: '#1e293b', // slate-800
    border: '#334155', // slate-700
    // violet 阶对称翻转 (50↔950、100↔900、200↔800、300↔700、400↔600、500 自映):
    // 深紫档 (50-500) 供底色/填充,亮紫档 (600-950) 供深底上的文字/强调
    brand: {
      50: '#2e1065',
      100: '#4c1d95',
      200: '#5b21b6',
      300: '#6d28d9',
      400: '#7c3aed',
      500: '#8b5cf6',
      600: '#a78bfa',
      700: '#c4b5fd',
      800: '#ddd6fe',
      900: '#ede9fe',
      950: '#f5f3ff',
    },
    slate: darkSlate,
    // info 统一取 accent 青 (D-003@v2 口径延续);
    // success/warning/error 为 500 系 (浅色主题 600 系提亮一档),neutral 取 slate-400
    semantic: {
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#22d3ee',
      neutral: '#94a3b8',
    },
  },
};

export const themes: Record<ThemeName, ThemeDef> = {
  blue: blueTheme,
  'ai-native': aiNativeTheme,
  dark: darkTheme,
};

export const DEFAULT_THEME: ThemeName = 'ai-native';
