---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-11
title: change-stage-actions 合并重构
---

# task-11: change-stage-actions 合并重构

- **allowed_paths**: `frontend/src/components/changes/detail/change-stage-actions.tsx`
- **改动**：合并推进横幅 + provider/model/触发两块为统一操作区；Props 去 `stageProvider`/`onStageProviderChange`/`stageModel`/`onStageModelChange`，加 `stageProfileId`/`onStageProfileChange`；顶部挂 `AgentProfileSelect`（workspaceId + value/onChange）；保留两按钮 onAdvance/onDispatch；档案选择器旁加提示文案「仅 provider/凭证/allowed_roots 生效，system_prompt/skill/mcp 下版本支持」（FR-08）。
- **完成标准**：UI 合并为一块；AgentProviderSelect/AgentModelInput 不再被 import；提示文案可见。
- **依赖**：task-10（Props 契约）。
