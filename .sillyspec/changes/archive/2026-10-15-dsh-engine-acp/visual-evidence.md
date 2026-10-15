# UI 视觉证据（visual-evidence）

- 变更 UI 面：单聊会话列表「第二层智能体下拉」新增 dsh（DeepSeek Harness）选项；引擎 chips/头像标签随 PROVIDER_META.dsh（🐳/蓝）。
- 原型分级：**跳过**（brainstorm Step5 用户确认——纯引擎枚举追加，无布局/结构/流程变化）。
- 渲染对照结论：
  - 下拉/筛选：选项由 SESSION_ENGINE_OPTIONS 单一源派生（frontend/src/lib/daemon/runtimes.ts:175-199），新增项走既有 `.map` 渲染路径，零新组件零样式面——形态与 codex/pi/cursor 选项逐字同构（page.test.tsx 49 用例含 dsh label 断言）。
  - 群聊面：ENGINE_OPTIONS/GROUP_SUPPORTED_PROVIDERS 未动（阶段 2 边界，源级钉断言在 page.test.tsx）——群聊 UI 零变化。
  - 引擎能力展示：provider-caps.ts 生成物仅数据键扩展，消费方（PROVIDER_SWITCH_ENGINES 等）自动派生，无视觉面改动。

## 用户裁决（视觉降级留痕）

- **用户裁决**：brainstorm Step 5「分段展示设计」AskUserQuestion（2026-10-15，本会话）——选项「跳过原型（纯后端+引擎枚举微调）」经用户亲选「确认」，原型分级=跳过为用户裁决结果，非静默降级。
- 依据：design.md 风险登记表「无 UI 原型」行（理由记入）+ requirements.md 非功能需求；progress 库回放记录该轮问答（Step5 第 1 轮答：确认）。
