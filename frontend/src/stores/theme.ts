/**
 * 主题偏好 store（task-04 / FR-02 / D-101@v1 / D-102@v1）。
 *
 * 数据流边界（localStorage 即真相源）：
 *   - producer：本 store 的 persist 写 localStorage["sillyhub-theme"]，
 *     partialize 仅持久化 theme 字段（D-102@v1）。
 *   - consumer1：app/layout.tsx 防闪烁 inline script（task-06）在首帧渲染前
 *     直读 localStorage 设置 html data-theme —— CSS 变量半边的唯一入口。
 *   - consumer2：antd-providers（task-05）经 useThemeStore state 取当前主题
 *     填 ConfigProvider token —— React 侧不走 localStorage 直读（D-101@v1
 *     双驱动机制的 state 半边）。
 *   - store 不持有 label/color 等派生值，消费方一律经 themes 查表取值
 *     （themes[theme].color / themes[theme].label，单一源见 styles/themes.ts）。
 *
 * 非法值兜底（design §9）：localStorage 脏值（非 blue/ai-native，如手动写入
 * "dark"）在 merge 阶段回退 DEFAULT_THEME，杜绝非法主题名进入渲染。
 * 结构对照 stores/session.ts 先例（create + persist + partialize）。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_THEME, themes, type ThemeName } from "@/styles/themes";

/** theme store 的状态与动作签名（design §7）。 */
export interface ThemeState {
  /** 当前主题名；初始与兜底均为 DEFAULT_THEME（ai-native）。 */
  theme: ThemeName;
  setTheme: (_theme: ThemeName) => void;
}

/**
 * useThemeStore — 主题偏好唯一状态源。
 *
 * setTheme 仅更新 theme 字段并触发 persist 写入 localStorage["sillyhub-theme"]，
 * 无其它副作用；html data-theme 同步归 task-05，首帧防闪烁归 task-06。
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "sillyhub-theme",
      partialize: (state) => ({ theme: state.theme }),
      // 非法值兜底：持久化 theme 不在 themes 键集合（blue/ai-native）时回退 DEFAULT_THEME
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<ThemeState>;
        const theme: ThemeName =
          persisted.theme !== undefined && persisted.theme in themes
            ? persisted.theme
            : DEFAULT_THEME;
        return { ...currentState, ...persisted, theme };
      },
    },
  ),
);
