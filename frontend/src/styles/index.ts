/**
 * Design Token barrel (task-01 / task-08)
 *
 * 组件统一从 `@/styles` 导入:
 *   import { themes, DEFAULT_THEME } from '@/styles';
 *
 * tokens.ts(含其 CSS 变量字符串注入)已删除 (task-08):取值单一源=themes.ts 注册表,
 * CSS 变量双套由 globals.css 直接维护,不再经 TS 字符串注入。
 */
export { themes, DEFAULT_THEME } from './themes';
export type { ThemeName, BrandScale, ThemeColorDef, ThemeDef } from './themes';
