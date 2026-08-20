/**
 * 主题注册表单一源 (task-01 / FR-01 / D-101@v1 / D-003@v2)
 *
 * - `themes`: blue(现版观感原样平移) 与 ai-native(默认,AI-Native 视觉) 两套完整取值,
 *   供 antd 等运行时消费方按当前主题取色 (themes[theme].color.*);
 *   task-02 的 globals.css CSS 变量双套、task-04 store、task-05 antd 动态化均以本文件为取值契约
 * - radius / shadow / font / spacing 两套主题共享,不进 ThemeDef,
 *   留在 globals.css 消费侧 (design §5 P0;原 tokens.ts 已于 task-08 删除)
 *
 * 色阶严格采用 Tailwind v3 默认值,禁止自行调色。
 * 新增颜色必须经本文件入口 (边界 #5,接替 tokens.ts 的 palette 入口职责)。
 * 例外 (D-003@v2): semantic.info 两主题统一取各自 accent 青,
 * blue 主题 info 不再是旧 tokens 的 #2563eb,保证状态语义跨主题一致 (design §9 例外声明)。
 */

export type ThemeName = 'blue' | 'ai-native';

/** 品牌色阶 50-950 十一档 (blue 主题=Tailwind blue 阶 / ai-native 主题=Tailwind violet 阶) */
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

/** 中性 slate 阶 (Tailwind v3 默认值,两主题共用,同原 tokens.slate) */
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

export const themes: Record<ThemeName, ThemeDef> = {
  blue: blueTheme,
  'ai-native': aiNativeTheme,
};

export const DEFAULT_THEME: ThemeName = 'ai-native';
