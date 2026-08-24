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
 * dark 取值 (变更 2026-08-23-frontend-dark-theme / ql-20260824-014 用户定案去紫改青):
 * 底换 zinc 中性黑 (bg/card/border=zinc-900/800/700,slate 阶换 zinc 对称翻转,
 * 去蓝调与紫/青的振动),主色 cyan-600(hover cyan-500),brand 阶=cyan 阶翻转
 * (50↔950、100↔900、200↔800、300↔700、400↔600、500 自映,text-brand-600=
 * cyan-400 夜间低疲劳),语义色较浅色主题提亮一档;仍全部取 Tailwind v3 默认值
 * (design §5.1),DEFAULT_THEME 保持 ai-native 不变。
 */

export type ThemeName = 'blue' | 'ai-native' | 'dark';

/** 品牌色阶 50-950 十一档 (blue=Tailwind blue 阶 / ai-native=Tailwind violet 阶 / dark=Tailwind cyan 阶翻转 ql-20260824-014) */
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
 * 取值策略:ql-20260824-014 用户定案「去紫改青」——蓝黑底(slate)与紫的振动是刺眼
 * 根因,底换 zinc 中性黑(900/800/700),主色换 cyan-600(hover 提亮 cyan-500),
 * 文字强调 brand-600=cyan-400(对比 8:1 夜间低疲劳,延续浅色主题交互青的品牌基因);
 * brand 阶=cyan 阶翻转(50↔950…500 自映),slate 阶=zinc 阶对称翻转。
 * 全部取值为 Tailwind v3 默认值,禁止自调。
 */
const darkTheme: ThemeDef = {
  name: 'dark',
  label: '暗夜',
  color: {
    primary: '#0891b2', // cyan-600 (ql-20260824-014 去紫改青;白字按钮对比 3.5:1)
    primaryHover: '#06b6d4', // cyan-500 (hover 提亮一档)
    accent: '#22d3ee', // cyan-400
    bg: '#18181b', // zinc-900 中性黑(去蓝调,与青/灰均不振动)
    card: '#27272a', // zinc-800
    border: '#3f3f46', // zinc-700
    // cyan 阶翻转 (50↔950、100↔900、200↔800、300↔700、400↔600、500 自映):
    // 深青档 (50-500) 供底色/填充(选中底/表头),亮青档 (600-950) 供深底文字/强调
    brand: {
      50: '#083344',
      100: '#164e63',
      200: '#155e75',
      300: '#0e7490',
      400: '#0891b2',
      500: '#06b6d4',
      600: '#22d3ee',
      700: '#67e8f9',
      800: '#a5f3fc',
      900: '#cffafe',
      950: '#ecfeff',
    },
    // 中性阶换 zinc 对称翻转(50↔950…400↔500)——中性灰随中性黑底
    slate: {
      50: '#09090b',
      100: '#18181b',
      200: '#27272a',
      300: '#3f3f46',
      400: '#52525b',
      500: '#71717a',
      600: '#a1a1aa',
      700: '#d4d4d8',
      800: '#e4e4e7',
      900: '#f4f4f5',
    },
    // info 统一取 accent 青 (D-003@v2 口径延续);
    // success/warning/error 为 500 系 (浅色主题 600 系提亮一档),neutral 取 zinc-400
    semantic: {
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#22d3ee',
      neutral: '#a1a1aa',
    },
  },
};

export const themes: Record<ThemeName, ThemeDef> = {
  blue: blueTheme,
  'ai-native': aiNativeTheme,
  dark: darkTheme,
};

export const DEFAULT_THEME: ThemeName = 'ai-native';
