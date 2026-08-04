---
author: qinyi
created_at: 2026-08-04 13:11:27
priority: P2
depends_on: []
requirement_ids: [FR-09]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/agent-profile-select.tsx
---

# task-06 选档下拉视觉对齐

> 把 agent-profile-select.tsx 原生 select 换成 antd Select(showSearch + optionFilterProp=label),视觉对齐 FRONTEND_PAGE_STYLE 新风格,逻辑零改动。依据 design §5 P6 / §7.3、D-005@v1;现状 L99-117 原生 select 偏离 §0「UI 组件全用 antd」。

## 实现要点

- L99 `<select>` 换 antd `<Select>`,带 showSearch 与 optionFilterProp="label",让长列表可按名搜索。
- 每条 option 同时给 value(p.id)与 label,label 用 renderOption 现有 parts 拼成的可见文案「名 (供应商/模型) · 系统预置/可见范围」,搜索按 label 过滤。
- onChange 直接收 antd 给的 value(非 event.target.value),沿用 `v === NO_PROFILE_VALUE ? null : v`,兜底项回 null 语义不变。
- 兜底项 NO_PROFILE_VALUE 置首项、文案 includeDefault;valueInvalid 仍追加渲染并标「(已失效)」,失效标记行为不变。
- 数据合并 useMemo(workspace ∪ platform 按 id 去重、workspace 优先、系统预置置顶后按 name 排)整段保留;样式交 antd token,移除 DEFAULT_CLS 的 tailwind 边框/聚焦类,h-8 由 token 接管,className 仍透传。

## 验收标准

- 渲染 antd Select,搜索框可按名过滤选项。
- 兜底项/失效标记渲染,以及 onChange 兜底回 null、有效项回 profile.id 的行为同改造前。
- value/onChange/workspaceId/includeDefault/disabled/className props 接口签名不变,drop-in 替换。
- 数据合并与排序逻辑无变更(git diff 仅 select→Select + option label 化)。
- `cd frontend && pnpm exec tsc --noEmit` 通过 0 error。

## 验证

cd frontend && pnpm exec tsc --noEmit

## 约束

- 仅视觉对齐,不动业务逻辑(D-005@v1);挂载点 tasks/[tid]/page.tsx:472 不改。
- 不新增 select 单测(现有 select 无单测;agent-profile-form.test.tsx 只测 form,与 select 无关)。
