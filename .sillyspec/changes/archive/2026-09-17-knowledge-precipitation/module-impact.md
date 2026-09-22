# 模块影响分析（骨架由 `sillyspec module-impact --change <变更名>` 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。
>
> ⚠️ plan 阶段说明：骨架生成时抓到的是工作区并行会话的脏文件，非本变更产物；本矩阵按 design.md「文件变更清单」（本变更计划改动）重排。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | backend/app/modules/knowledge/parser.py | 逻辑变更（glob→rglob + zone 归类） | 否 |
| backend | backend/app/modules/knowledge/schema.py | 接口变更（KnowledgeEntryRead 增 zone；新增 propose/update/merge/reject/distill DTO） | 否 |
| backend | backend/app/modules/knowledge/service.py | 逻辑变更（zone 透传；get 按 filename 精确匹配） | 否 |
| backend | backend/app/modules/knowledge/router.py | 接口变更（新增 7 写端点 + 字面量路由前置约束） | 否 |
| backend | NEW:backend/app/modules/knowledge/writer.py | 新增（KnowledgeWriterService，FileOp→apply_ops 单写者语义） | 是（apply_ops 调用面/409 契约） |
| backend | NEW:backend/app/modules/knowledge/distill.py | 新增（DistillDispatchService，AgentRun metadata_/AgentRunWorkspace） | 是（派发链路复用 bootstrap） |
| backend | backend/app/modules/auth/permissions.py | 数据结构变更（Permission 增 KNOWLEDGE_WRITE） | 否 |
| backend | NEW:backend/migrations/versions/<定号>_add_knowledge_write_permission.py | 数据结构变更（角色-权限播种，存量角色按 key SELECT） | 是（migration 正确性） |
| backend | backend/openapi.json | 接口变更（随代码再生成） | 否 |
| frontend | frontend/src/lib/api-types.ts | 数据结构变更（pnpm gen:types 再生成：zone + 新 DTO） | 否 |
| frontend | frontend/src/lib/knowledge.ts | 接口变更（新增 propose/update/merge/reject/distill API 封装） | 否 |
| frontend | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | 逻辑变更（zone 分组树 + 操作区 + 任务条挂载） | 否 |
| frontend | NEW:frontend/src/components/knowledge/precipitate-dialog.tsx | 新增（沉淀弹层双 tab） | 否 |
| frontend | NEW:frontend/src/components/knowledge/merge-dialog.tsx | 新增（合并预览/确认） | 否 |
| frontend | NEW:frontend/src/components/knowledge/entry-editor.tsx | 新增（条目编辑态） | 否 |
| frontend | NEW:frontend/src/components/knowledge/distill-task-bar.tsx | 新增（蒸馏任务条轮询） | 否 |

跨模块依赖说明：knowledge 写侧调用 spec_workspace 的 apply_ops（服务端新调用方，D-011 单写者语义不变）；distill 调用 agent 模块 AgentRun/AgentRunWorkspace（bootstrap 先例）；daemon/sillyhub-daemon 零改动。

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `docs/sillyspec/2026-09-07-docs-check-fix-improvement-proposal.md` — 非本变更：另一并行会话的 docs/sillyspec 整理移动（→finished/），归属 docs 模块游离态
- `docs/sillyspec/daemon-spawn-node-hang.md` — 同上（非本变更）
- `docs/sillyspec/external-mode-no-root-session-resolution.md` — 同上（非本变更）
- `docs/sillyspec/quick-sync-block-filenotes-and-quicklog-mixed-commit.md` — 同上（非本变更）
- `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx` — 非本变更：并行 quick 会话（quick-5d619e37 等）改动
- `frontend/src/components/__tests__/change-file-tree.test.tsx` — 同上（非本变更）
- `frontend/src/components/daemon/__tests__/session-usage-panel-mount.test.tsx` — 同上（非本变更）
- `frontend/src/components/files/__tests__/file-preview-modal.test.tsx` — 同上（非本变更）
- `frontend/src/components/files/__tests__/preview-registry.test.ts` — 同上（非本变更）
- `frontend/src/lib/__tests__/daemon-session.test.ts` — 同上（非本变更）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `.sillyspec/docs/backend/modules/knowledge.md` | 增量节已写（定位改「读侧+平台写侧」；契约摘要补 7 新端点/409 契约/两段式 merge/zone 递归；注意事项补 decisions 只读与 INDEX 路由行 R-03 同源） | done |
| `.sillyspec/docs/backend/modules/auth.md` | 增量节已写（契约摘要补 KNOWLEDGE_WRITE：knowledge:write、WORKSPACE 组、migration 20260917104400 播种 platform_admin/workspace_owner） | done |
| `.sillyspec/docs/SillyHub/modules/spec_workspace.md` | 增量节已写（注意事项补 knowledge writer 为 apply_ops 新服务端调用方，D-011 单写者语义不变） | done |
| `.sillyspec/docs/SillyHub/modules/frontend_components.md` | 增量节已写（契约摘要补知识域 4 组件：precipitate-dialog/entry-editor/merge-dialog/distill-task-bar） | done |
| `_module-map.yaml` | 无需增改：本变更新增文件均落在既有 backend/frontend 模块 paths 内；未匹配文件属并行会话非索引过期 | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
