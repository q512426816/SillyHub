/**
 * 主题偏好 store（task-04 / FR-02 / D-101@v1 / D-102@v1；
 * 2026-08-23-frontend-dark-theme：FR-03 / D-002@v1 无记录跟随系统）。
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
 * 初始主题三分支（design §9 + D-002@v1 / FR-03，2026-08-23-frontend-dark-theme）：
 *   - 无记录（persisted.theme === undefined，用户从未选择）：经 window.matchMedia
 *     读系统 prefers-color-scheme，命中 dark 则初始为 dark，否则 DEFAULT_THEME；
 *     与 app/layout.tsx 防闪烁脚本成对一致，防止 React 水合后 useEffect 把
 *     首帧脚本判出的 dark 覆盖回默认。matchMedia 仅在 merge（客户端 persist
 *     水合）内访问且带存在性与异常保护，SSR 安全。
 *   - 合法值（blue/ai-native/dark）透传，取值域见 styles/themes.ts。
 *   - 非法值兜底（design §9）：localStorage 脏值（非 blue/ai-native/dark）
 *     在 merge 阶段回退 DEFAULT_THEME，杜绝非法主题名进入渲染。
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
      // 初始主题三分支（D-002@v1 / FR-03）：合法值（blue/ai-native/dark）透传；
      // 无记录（undefined，从未选择）读 prefers-color-scheme 跟随系统（命中 dark
      // 则 dark，否则 DEFAULT_THEME），与 layout.tsx 防闪烁脚本成对；非法值回退
      // DEFAULT_THEME（design §9 口径不变）。matchMedia 防御式调用——merge 仅在
      // 客户端 persist 水合时执行，且包 try-catch（不可用/抛错回落 DEFAULT_THEME）。
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<ThemeState>;
        let theme: ThemeName;
        if (persisted.theme !== undefined && persisted.theme in themes) {
          // 合法持久化值：透传（取值域随 themes.ts 扩为三主题）
          theme = persisted.theme;
        } else if (persisted.theme === undefined) {
          // 无记录 = 从未选择：跟随系统 prefers-color-scheme（D-002@v1）
          theme = DEFAULT_THEME;
          try {
            if (
              typeof window !== "undefined" &&
              window.matchMedia?.("(prefers-color-scheme: dark)").matches
            ) {
              theme = "dark";
            }
          } catch {
            // matchMedia 不可用或抛异常：保持 DEFAULT_THEME（与 layout 脚本兜底成对）
          }
        } else {
          // 非法持久化值：回退 DEFAULT_THEME（design §9，现状口径不变）
          theme = DEFAULT_THEME;
        }
        return { ...currentState, ...persisted, theme };
      },
    },
  ),
);
