---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-13
title: 前端组件测试更新
---

# task-13: 前端组件测试更新

- **allowed_paths**: `frontend/src/components/changes/detail/__tests__/`、`frontend/src/components/__tests__/`
- **改动**：`change-stage-actions.test.tsx` 更新（去 provider/model 断言，加档案选择断言 + 两按钮）；`stage-team-config.test.tsx` 更新（worker 选档案）。
- **完成标准**：vitest 全过。
- **依赖**：task-11 + task-12。
