/**
 * 思考内容离线翻译偏好 store（2026-10-19-thinking-zh-translate / FR-01）。
 *
 * localStorage 即真相源：persist 写 localStorage["sillyhub-thinking-translate"]
 * （partialize 仅 enabled 字段）。默认开启（用户诉求「默认翻译成中文展示」）；
 * 关闭后所有思考渲染路径回退原文展示且不发请求（lib/thinking-translate 出口
 * 统一判定，组件不各自读 localStorage）。
 *
 * 结构对照 stores/theme.ts 先例（create + persist + partialize）。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 翻译偏好 store 的状态与动作签名。 */
export interface ThinkingTranslateState {
  /** 思考内容是否默认翻译为中文展示；初始与兜底均为 true。 */
  enabled: boolean;
  setEnabled: (_enabled: boolean) => void;
}

export const useThinkingTranslateStore = create<ThinkingTranslateState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
    }),
    {
      name: "sillyhub-thinking-translate",
      partialize: (state) => ({ enabled: state.enabled }),
      // 非法持久化值（非 boolean）回退默认开启
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<ThinkingTranslateState>;
        const enabled =
          typeof persisted.enabled === "boolean" ? persisted.enabled : true;
        return { ...currentState, enabled };
      },
    },
  ),
);
