---
author: WhaleFall
created_at: 2026-06-08T12:20:00
---

# 模块影响矩阵

变更：2026-06-08-change-center-columns（变更中心列展示优化）

## 三重交叉验证

| 来源 | 文件数 | 一致性 |
|---|---|---|
| 声明范围（design.md） | 3 | ✅ 与 git diff 一致 |
| 任务范围（tasks.md） | 3 | ✅ 与 git diff 一致 |
| 真实变更（git diff HEAD） | 3 源文件 + 文档 | ✅ 源文件完全一致 |

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| change | 逻辑变更 | `backend/app/modules/change/parser.py` (+266 行) | 新增 `_infer_change_type()` 从目录结构推断变更类型（feature/quick/prototype）；新增 `_infer_affected_components()` 从 tasks.md 文件路径提取影响模块名（含 5 个辅助方法） | false |
| change | 逻辑变更 | `backend/app/modules/change/service.py` (+12 行) | `_apply_parsed()` 新增 reparse 覆盖逻辑：change_type 仅在 DB 值为 null 时覆盖，affected_components 有值时始终覆盖 | false |
| frontend_app | 逻辑变更 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` (+52/-21 行) | 状态列改用 human_gate 展示待办 Badge（GATE_LABELS）；阶段列 null 兜底 draft；类型列颜色映射（TYPE_COLORS） | false |

## 未匹配文件

| 文件 | 说明 |
|------|------|
| `.sillyspec/changes/2026-06-08-change-center-columns/**` | 变更文档（proposal/design/requirements/tasks/plan/prototype/task-01~05/verify-result） |
| `.sillyspec/changes/archive/2026-06-08-2026-06-05-agent-log-width/**` | 前序变更归档文件 |
| `.sillyspec/quicklog/QUICKLOG-WhaleFall.md` | Quick log 记录 |
| `CLAUDE.md` | 项目指令文件（stage:archive 任务上下文） |

## 影响汇总

- **变更模块数**：2（change + frontend_app）
- **新增代码**：~330 行（后端 278 + 前端 52）
- **删除代码**：~21 行
- **数据模型变更**：无（复用现有 change_type + affected_components 字段）
- **API 变更**：无（复用现有 reparse 流程）
- **破坏性变更**：无
