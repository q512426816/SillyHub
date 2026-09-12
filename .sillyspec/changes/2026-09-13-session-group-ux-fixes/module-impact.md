# 模块影响分析（骨架由 `sillyspec module-impact --change <变更名>` 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | backend/app/modules/daemon/group/service/crud.py | 逻辑变更（新增 get_project_workspace_map 批量查辅助，只读 PpmProjectWorkspace） | no |
| backend | backend/app/modules/daemon/group/router.py | 接口变更（GroupChatListItemRead 加 visible_workspace_ids 字段 + 端点组装；纯增量默认空） | yes（API 契约面） |
| frontend | frontend/src/components/daemon/session-panel/turn-state.ts | 逻辑变更（草稿键函数 preScope 三参） | no |
| frontend | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 调用关系变更（草稿两 effect 传 scope） | no |
| frontend | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 调用关系变更（预会话传 workspace 维度 scope） | no |
| frontend | frontend/src/components/daemon/session-input-bar.tsx | 逻辑变更（拖拽 mouse→Pointer Events） | no |
| frontend | frontend/src/components/group-chat/group-chat-panel.tsx | 逻辑变更（同款拖拽副本迁移） | no |
| frontend | frontend/src/components/sessions/session-list-panel.tsx | 逻辑变更（workspace 过滤改集合判定） | no |
| frontend | frontend/src/components/mobile/mobile-session-list.tsx | 逻辑变更（同款过滤迁移） | no |
| frontend | frontend/src/lib/api-types.ts | 数据结构变更（gen:types 重生成，visible_workspace_ids） | no（生成物） |
| backend | backend/openapi.json | 数据结构变更（gen:types 产物） | no（生成物） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `docs/sillyspec/conflict-compare-wrong-status-root.md` 归属判定：**非本变更文件**——仓库既有未提交的 docs/sillyspec 归档移动（git status 快照里的 D/?? 对），与本变更无关，不纳入本次影响分析
- `docs/sillyspec/docs-gate-shared-worktree-parallel-block.md` 同上，非本变更文件
- `docs/sillyspec/platform-spec-junction-migration-split.md` 同上，非本变更文件
- `docs/sillyspec/platform-sync-progress-rollback-and-db-corruption.md` 同上，非本变更文件
- `docs/sillyspec/pre-commit-autofix-swallows-commit.md` 同上，非本变更文件

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无未匹配的本变更文件（5 个 docs/sillyspec 均为仓库既有游离提交物），无需 rebuild | skipped（原因：非本变更范围） |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
