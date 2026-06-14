---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# change

> 最后更新：2026-06-14
> 最近变更：2026-06-14-agent-runtime-selection（stage 手动 dispatch 入口增 provider 覆盖）
> 模块路径：`app/modules/change/**`

## 职责

管理变更（Change）的全生命周期：从文件系统解析、DB 持久化、10 阶段状态机流转、审批、反馈、文档同步、归档门禁检查，以及 Agent 自动调度。

## 当前设计

### 架构

```
ChangeService（业务层）
  ├── ChangeParser（文件系统解析）— .sillyspec/changes/ 结构解析
  ├── 状态机 TRANSITIONS — 10 阶段 × 角色权限矩阵
  ├── transition_with_dispatch() — 状态流转 + Agent 调度
  ├── dispatch.py — Agent 调度逻辑（独立 session）
  └── M:N enrichment — ChangeWorkspace 关联查询
```

### 关键逻辑

1. **状态机**：`TRANSITIONS` 字典定义合法流转边，`StageEnum` 10 阶段（draft → clarifying → design_review → … → archived）
2. **Reparse**：遍历 `.sillyspec/changes/` 目录，UPSERT Change + ChangeDocument，删除消失的行
3. **流转 + 调度**：`transition_with_dispatch()` 先提交流转，再用独立 session 触发 Agent 调度（避免 SQLAlchemy 并发冲突）
4. **反馈机制**：4 类反馈 A/B/C/D 对应不同回退目标（in_dev/design_review/clarifying/accepted）
5. **归档门禁**：6 项检查（无未解决反馈、AC 确认、技术验证通过、业务评审通过、反馈已分类、文档完整）
6. **M:N 关联**：Change 可关联多个 Workspace（通过 `affected_components` 匹配 `component_key`）
7. **文档内容**：从文件系统按需读取，不存 DB；有路径遍历防护和 1MB 大小限制
8. **Stage 手动 dispatch provider 透传**（2026-06-14）：`dispatch()` / `dispatch_next_step()` 增 `provider` 形参，透传 `start_stage_dispatch(provider=)`；`manual_dispatch` 端点接收 `ManualDispatchRequest{provider?}`（FR-06）。自动调度链路（`auto_dispatch_next_step`）**不传** provider，由 `start_stage_dispatch` 内部读 `workspace.default_agent` 兜底（FR-04 / R-03）。

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| `GET /workspaces/{ws}/changes` | `list_changes()` | 列出变更（支持 location/status/owner 过滤） | 前端 |
| `GET /workspaces/{ws}/changes/{id}` | `get_change()` | 获取单个变更详情 | 前端 |
| `POST /workspaces/{ws}/changes/reparse` | `reparse_changes()` | 从文件系统重新解析变更 | 前端 |
| `GET /workspaces/{ws}/changes/{id}/documents` | `get_change_documents()` | 文档矩阵（prototype/reference 列表） | 前端 |
| `GET /workspaces/{ws}/changes/{id}/documents/{type}` | `get_change_document()` | 读取文档内容 | 前端 |
| `POST /workspaces/{ws}/changes/{key}/progress` | `update_progress()` | 更新进度（current_stage + stages） | Agent |
| `GET /workspaces/{ws}/changes/{key}/approval` | `get_approval()` | 获取审批状态 | 前端 |
| `POST /workspaces/{ws}/changes/{key}/approve` | `approve_change()` | 审批通过 | 前端 |
| `POST /workspaces/{ws}/changes/{key}/reject` | `reject_change()` | 驳回 | 前端 |
| `POST /workspaces/{ws}/changes/{key}/documents` | `sync_documents()` | 同步文档到文件系统 + DB | Agent |
| `POST /workspaces/{ws}/changes/{id}/transition` | `transition_change()` | 状态流转 + 可选 Agent 调度 | 前端 |
| `POST /workspaces/{ws}/changes/{id}/feedback` | `submit_feedback()` | 提交反馈（A/B/C/D） | 前端 |
| `GET /workspaces/{ws}/changes/{id}/archive-gate` | `check_archive_gate()` | 归档门禁 6 项检查 | 前端 |
| `GET /workspaces/{ws}/changes/{id}/agent-status` | `get_agent_status()` | Agent 调度状态 | 前端 |
| `POST /workspaces/{ws}/changes/{id}/dispatch` | `manual_dispatch()` | 手动触发 Agent 调度；**2026-06-14 起** 接收 `ManualDispatchRequest{provider?}` 覆盖默认 agent，透传 `dispatch(provider=)` → `start_stage_dispatch(provider=)` | 前端 |

## 关键数据流

```
POST /changes/{id}/transition → ChangeService.transition_with_dispatch()
  → transition()                              # 状态机校验 + 角色检查
    → TRANSITIONS[current][target] 验证
    → 角色权限检查（admin bypass）
    → 记录 transitions 日志到 stages JSON
    → UPDATE Change.current_stage
    → COMMIT
  → dispatch()（独立 session）               # Agent 调度
    → get_config_for_stage(target_stage)
    → 检查是否有活跃 run
    → 创建 AgentRun → 触发 Claude Code
```

```
POST /changes/{id}/feedback → ChangeService.submit_feedback()
  → 校验 category（A/B/C/D）
  → 检查当前阶段（仅 tech_verification / business_review）
  → D: 直接 → accepted（衍生新 change）
  → A/B/C: → rework_required + 记录 rework_target
  → COMMIT
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| 状态机用字典而非 FSM 库 | 10 阶段固定、无动态扩展需求 | model.py `TRANSITIONS` |
| 文档内容不存 DB | 按需读文件，避免 DB 膨胀 | service.py `get_document_content` |
| 调度用独立 session | 避免 transition 的 session 未提交时并发操作 | service.py `transition_with_dispatch` |
| Reparse 不覆盖 DB 元数据 | DB 是 status/change_type/affected_components 真相源；parser 不读 frontmatter，title 取自 proposal.md 首个 # 标题，fallback change_key | service.py `_apply_parsed`、parser.py `_extract_title` |
| 反馈类别 A/B/C/D 映射回退目标 | 简化分类，前端无需选择目标阶段 | service.py `submit_feedback` |
| stages 字段存 JSONB | 灵活存储 transitions 日志、dispatch 信息等 | model.py `stages` |

## 依赖关系

### 依赖本模块
- `task/service.py`：TaskService 依赖 ChangeService 验证 change 存在
- `worktree/service.py`：获取 change_id 关联
- `agent/` 模块：dispatch 触发 AgentRun
- 前端变更详情页、看板、工作流 UI

### 本模块依赖
- `workspace/model`：ChangeWorkspace M:N 表
- `workspace/service`：WorkspaceService 校验 workspace 存在
- `change/parser`：文件系统解析器
- `change/dispatch`：Agent 调度逻辑
- `core/errors`：ChangeNotFound、InvalidTransition 等 4 种错误

## 注意事项

- `list_()` 查询可能返回重复行（主 workspace FK + M:N 重叠），需内存去重
- 归档门禁检查中"文档完整"依赖 `ChangeDocument.status`，reparse 时需同步更新
- MASTER.md 是可选文件（仅大需求拆分时生成）：parser 缺失时不报警、status 默认 draft；解析器只做文件存在性检查 + 标题提取，不再解析任何 frontmatter 元数据
- 标准文档类型含 `module_impact`（module-impact.md）；前端 doc_type 用 `verify_result`（对应 verify-result.md），勿写成 `verification`
- Agent 调度是 best-effort：失败不回滚已提交的状态流转
- 文档读取有 1MB 大小限制（`MAX_CONTENT_BYTES`），超大文件截断返回
- 路径遍历防护：`resolved` 必须以 `root.resolve()` 为前缀

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-06-14 | 2026-06-14-agent-runtime-selection | stage 手动 dispatch 入口增 `ManualDispatchRequest{provider?}`；dispatch/dispatch_next_step 透传 provider → start_stage_dispatch；自动调度链路不传 provider（内部读 default_agent 兜底） |
| 2026-05-31 | 初始归档 | 从代码逆向生成模块文档 |
| 2026-06-03 | 文档解析对齐生命周期 | MASTER.md 改可选、parser 移除 frontmatter 解析、title 取自 proposal.md、标准文档新增 module_impact |
