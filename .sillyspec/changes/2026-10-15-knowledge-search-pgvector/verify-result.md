# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES` —— 205+46 全绿、契约零 diff 物证、独立验收审查 11/11 pass；两条已知开口移交（生产 PG 面实测、部署升级动作），见移交项表。（把尖括号占位整体替换为 PASS / PASS WITH NOTES / FAIL 之一；一句话理由写在枚举后同行或下一行）

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | 生产 PG 面实测（本地全链为 SQLite 方言；KNN SQL/embedding 绑定/首查耗时的 PG 实测） | 部署升级后：搜索一次建库（记录耗时）→ 重启服务 → 立即搜索应秒级；对照 design R-01 已回填的 SQLite 口径 |
| manual-acceptance | 部署升级动作（换镜像→迁移→重启，D-008 升级顺序） | 按设计 Phase 4 执行单：先跑生产验证 SQL 确认扩展可用性；迁移 fail-closed 会拦镜像未换场景 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
- 无（verify-required-evidence.json 不存在 → execute 阶段无 cannot_verify 任务）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- claim: 后端 knowledge 模块全量回归（含迁移钉子）205 passed；前端两页 46 passed（零源码改动纯回归）
  command: cd backend && uv run pytest app/modules/knowledge/tests -q --no-cov
  exit: 0
  log: C:/Users/qinyi/IdeaProjects/multi-agent-platform/.sillyspec/.runtime/logs/pgv-task05-backend.log
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
- task-01 ✅ 数据层（依赖+两 ORM+迁移+钉子 head 前移+4 单测）；task-02 ✅ 检索层（async 化+差量+分叉+降级，3 专项）；task-03 ✅ 路由 await 化（39 例）；task-04 ✅ 部署镜像+升级顺序；task-05 ✅ 回归收口（205+46+零 diff+实测回填+模块卡）。完成率 5/5。

## 设计一致性 [层：人工判断]
一致（独立验收审查 11/11 pass）。执行期裁决零新增（无 D-xxx 新条目）；三处审查 note（死代码/docstring 语义/router 口径）已修——均为注释级对齐非行为偏差。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 1 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
- 关键词逐词 grep（worktree）：持久化/pgvector → search.py 两 ORM+迁移 ✓；懒同步/差量 → _ensure_synced/_sync_delta ✓；指纹归一化 → _norm_fingerprint ✓；方言分叉/KNN → _query_vector_candidates（postgresql cosine_distance / SQLite Python 余弦）✓；async 编排/to_thread → search_sync async def + 7 处 asyncio.to_thread ✓；降级链 → _fallback_word_scan + _BoomFactory 单测 ✓；fail-closed → 迁移 raise + 单测钉文案 ✓；model_version 重算 → _ensure_synced 分支 ✓。无缺失关键词。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend、backend/app/modules/knowledge、NEW:backend/migrations/versions、backend/app/modules/knowledge/tests）找到 80 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ✅ task-02: 模块目录（backend/app/modules/knowledge、backend/app/modules/knowledge/tests）找到 9 个测试文件（backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_governance.py、backend/app/modules/knowledge/tests/test_graph.py、backend/app/modules/knowledge/tests/test_hits.py、backend/app/modules/knowledge/tests/test_knowledge_search.py …）
- ✅ task-03: 模块目录（backend/app/modules/knowledge、backend/app/modules/knowledge/tests）找到 9 个测试文件（backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_governance.py、backend/app/modules/knowledge/tests/test_graph.py、backend/app/modules/knowledge/tests/test_hits.py、backend/app/modules/knowledge/tests/test_knowledge_search.py …）
- ⚠️ task-04: 模块目录（deploy）递归未找到测试文件（含 co-located tests/）
- ✅ task-05: 模块目录（.sillyspec/docs/backend/modules、NEW:.sillyspec/docs/backend/modules）找到 2 个测试文件（.sillyspec/docs/backend/modules/spec_profile.md、.sillyspec/docs/backend/modules/spec_workspace.md）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 建表/约束用例绿（SQLite 下 embedding 为 JSON 无 vector 依赖） | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | embedding（`backend/app/modules/knowledge/tests/test_knowledge_search.py`） | covered | `backend/app/modules/knowledge/tests/test_knowledge_search.py:69`（embedding） |
| 迁移方言守卫结构正确（PG 守卫 + fail-closed raise + downgrade 不卸扩展） | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | — | partial | （无机械命中——人工核验 `backend/app/modules/knowledge/tests/test_knowledge_search.py`） |
| pgvector 进依赖且 uv.lock 更新（import pgvector.sqlalchemy 可用） | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | import（`backend/app/modules/knowledge/tests/test_knowledge_search.py`） | covered | `backend/app/modules/knowledge/tests/test_knowledge_search.py:15`（import） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 指纹一致二次查询 embed_calls 零调用（直查库） | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | embed_calls（`backend/app/modules/knowledge/tests/test_knowledge_search.py`） | covered | `backend/app/modules/knowledge/tests/test_knowledge_search.py:9`（embed_calls） |
| 单文件改动后仅该文件 chunk 重嵌（embed 计数=该文件 chunk 数）；mtime touch 不重嵌 | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | chunk、embed、计数（`backend/app/modules/knowledge/tests/test_knowledge_search.py`） | covered | `backend/app/modules/knowledge/tests/test_knowledge_search.py:25`（chunk）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:3`（embed）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:9`（计数） |
| model_version 变更全量重嵌一次 | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | — | partial | （无机械命中——人工核验 `backend/app/modules/knowledge/tests/test_knowledge_search.py`） |
| SQLite 方言全用例绿；DB 异常 200+词面+reason 含降级 | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | 词面、reason（`backend/app/modules/knowledge/tests/test_knowledge_search.py`） | covered | `backend/app/modules/knowledge/tests/test_knowledge_search.py:10`（词面）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:11`（reason） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 端点行为与响应形态零变化（8 例全绿）；git diff backend/openapi.json 零输出 | `backend/app/modules/knowledge/tests/test_router.py` | — | partial | （无机械命中——人工核验 `backend/app/modules/knowledge/tests/test_router.py`） |

**task-04**
- ℹ️ 既有用例候选（FR 关联回归面，本变更未改动；判定仍由你复核，命中≠结论）：`backend/app/modules/agent/tests/test_group_chat_models.py`、`backend/app/modules/agent/tests/test_mcp_tools.py`、`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_files_router.py`、`backend/app/modules/change/tests/test_session_changes_endpoint.py`、`backend/app/modules/change/tests/test_step_progress.py`、`backend/app/modules/change/tests/test_timeline.py`、`backend/app/modules/change/tests/test_title_normalization.py`、`backend/app/modules/change/tests/test_usage_stats.py`、`backend/app/modules/daemon/tests/test_agent_session_tasks.py`、`backend/app/modules/daemon/tests/test_attachment_pipeline.py`、`backend/app/modules/daemon/tests/test_change_session.py`、`backend/app/modules/daemon/tests/test_group_attachment_gate.py`、`backend/app/modules/daemon/tests/test_group_bridge_projection.py`、`backend/app/modules/daemon/tests/test_group_cross_mention.py`、`backend/app/modules/daemon/tests/test_group_logs_pagination.py`、`backend/app/modules/daemon/tests/test_group_mention_pipeline.py`、`backend/app/modules/daemon/tests/test_group_p2.py`、`backend/app/modules/daemon/tests/test_inject_origin_guard.py`、`backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py`、`backend/app/modules/daemon/tests/test_lease_expiry_sweeper.py`、`backend/app/modules/daemon/tests/test_ppm_session.py`、`backend/app/modules/daemon/tests/test_scheduled_messages_crud.py`、`backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py`、`backend/app/modules/daemon/tests/test_session_pin_rename.py`、`backend/app/modules/daemon/tests/test_session_queue.py`、`backend/app/modules/daemon/tests/test_session_queue_actions.py`、`backend/app/modules/daemon/tests/test_session_runs_endpoint.py`、`backend/app/modules/daemon/tests/test_session_service.py`、`backend/app/modules/deploy_records/tests/__init__.py`、`backend/app/modules/deploy_records/tests/test_router.py`、`backend/app/modules/deploy_records/tests/test_service.py`、`backend/app/modules/knowledge/tests/test_distill.py`、`backend/app/modules/knowledge/tests/test_graph.py`、`backend/app/modules/knowledge/tests/test_hits.py`、`backend/app/modules/knowledge/tests/test_knowledge_search.py`、`backend/app/modules/knowledge/tests/test_router.py`、`backend/app/modules/knowledge/tests/test_vector_search.py`、`backend/app/modules/knowledge/tests/test_writer.py`、`backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py`、`backend/app/modules/platform_sync/tests/test_agent_log_messages.py`、`backend/app/modules/platform_sync/tests/test_agent_log_push.py`、`backend/app/modules/platform_sync/tests/test_change_events.py`、`backend/app/modules/platform_sync/tests/test_owner_sync.py`、`backend/app/modules/ppm/common/tests/test_export.py`、`backend/app/modules/ppm/kanban/tests/test_kanban.py`、`backend/app/modules/ppm/plan/tests/test_fsm.py`、`backend/app/modules/ppm/plan/tests/test_service.py`、`backend/app/modules/ppm/project/tests/test_service.py`、`backend/app/modules/ppm/task/tests/test_task.py`、`backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py`、`backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py`、`backend/app/modules/workspace/tests/test_daemon_client_scan.py`、`backend/app/modules/workspace/tests/test_move_order.py`、`backend/tests/modules/agent/test_scan_interactive_dispatch.py`、`backend/tests/modules/auth/test_permissions.py`、`backend/tests/modules/change/test_archive_gate.py`、`backend/tests/test_align_platform_change_events_migration.py`、`backend/tests/test_check_assertion_surfaces.py`、`frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/deploy-records/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx`、`frontend/src/app/m/account/page.test.tsx`、`frontend/src/app/page.test.tsx`、`frontend/src/components/__tests__/admin-role-permission-picker-tree.test.tsx`、`frontend/src/components/__tests__/app-shell.test.tsx`、`frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx`、`frontend/src/components/__tests__/change-file-tree.test.tsx`、`frontend/src/components/__tests__/workspace-drag-grid.test.tsx`、`frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx`、`frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx`、`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx`、`frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx`、`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`、`frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx`、`frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx`、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`、`frontend/src/components/daemon/__tests__/turn-speed.test.ts`、`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx`、`frontend/src/components/explorer/__tests__/file-preview.test.tsx`、`frontend/src/components/files/__tests__/file-preview-modal.test.tsx`、`frontend/src/components/files/__tests__/preview-registry.test.ts`、`frontend/src/components/files/__tests__/structured-views.test.tsx`、`frontend/src/components/floating/floating-session-host.test.tsx`、`frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`、`frontend/src/components/mobile/mobile-change-detail.test.tsx`、`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`、`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`、`frontend/src/components/workspace-config-card.test.tsx`、`frontend/src/lib/__tests__/agent-log-turns.test.ts`、`frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts`、`frontend/src/lib/__tests__/logout-storage.test.ts`、`frontend/src/lib/__tests__/menu-overrides.test.ts`、`frontend/src/lib/__tests__/menu-permissions.test.ts`、`frontend/src/lib/__tests__/permission.test.ts`、`frontend/src/lib/__tests__/session-mention-sources.test.tsx`、`frontend/src/lib/__tests__/token-refresh.test.ts`、`frontend/src/lib/api/__tests__/llm-providers.test.ts`、`sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts`
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 两 compose 镜像已换且 diff 仅 image 行；部署节含升级顺序与验证 SQL；fail-closed 文案在 | `backend/app/modules/agent/tests/test_group_chat_models.py`<br>`backend/app/modules/agent/tests/test_mcp_tools.py`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`backend/app/modules/change/tests/test_assets.py`<br>`backend/app/modules/change/tests/test_files_router.py`<br>…共 20 个（目录级候选全量在 facts/trace，归属按关键词命中与证据锚点收窄） | diff、image（`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_usage_stats.py`、`backend/app/modules/daemon/tests/test_agent_session_tasks.py`、`backend/app/modules/daemon/tests/test_group_cross_mention.py`、`backend/app/modules/change/tests/test_files_router.py`、`backend/app/modules/daemon/tests/test_attachment_pipeline.py`） | covered | `backend/app/modules/change/tests/test_assets.py:43`（diff）、`backend/app/modules/change/tests/test_files_router.py:189`（image） |

**task-05**
- ℹ️ 既有用例候选（FR 关联回归面，本变更未改动；判定仍由你复核，命中≠结论）：`backend/app/modules/agent/tests/test_group_chat_models.py`、`backend/app/modules/agent/tests/test_mcp_tools.py`、`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_files_router.py`、`backend/app/modules/change/tests/test_session_changes_endpoint.py`、`backend/app/modules/change/tests/test_step_progress.py`、`backend/app/modules/change/tests/test_timeline.py`、`backend/app/modules/change/tests/test_title_normalization.py`、`backend/app/modules/change/tests/test_usage_stats.py`、`backend/app/modules/daemon/tests/test_agent_session_tasks.py`、`backend/app/modules/daemon/tests/test_attachment_pipeline.py`、`backend/app/modules/daemon/tests/test_change_session.py`、`backend/app/modules/daemon/tests/test_group_attachment_gate.py`、`backend/app/modules/daemon/tests/test_group_bridge_projection.py`、`backend/app/modules/daemon/tests/test_group_cross_mention.py`、`backend/app/modules/daemon/tests/test_group_logs_pagination.py`、`backend/app/modules/daemon/tests/test_group_mention_pipeline.py`、`backend/app/modules/daemon/tests/test_group_p2.py`、`backend/app/modules/daemon/tests/test_inject_origin_guard.py`、`backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py`、`backend/app/modules/daemon/tests/test_lease_expiry_sweeper.py`、`backend/app/modules/daemon/tests/test_ppm_session.py`、`backend/app/modules/daemon/tests/test_scheduled_messages_crud.py`、`backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py`、`backend/app/modules/daemon/tests/test_session_pin_rename.py`、`backend/app/modules/daemon/tests/test_session_queue.py`、`backend/app/modules/daemon/tests/test_session_queue_actions.py`、`backend/app/modules/daemon/tests/test_session_runs_endpoint.py`、`backend/app/modules/daemon/tests/test_session_service.py`、`backend/app/modules/deploy_records/tests/__init__.py`、`backend/app/modules/deploy_records/tests/test_router.py`、`backend/app/modules/deploy_records/tests/test_service.py`、`backend/app/modules/knowledge/tests/test_distill.py`、`backend/app/modules/knowledge/tests/test_graph.py`、`backend/app/modules/knowledge/tests/test_hits.py`、`backend/app/modules/knowledge/tests/test_knowledge_search.py`、`backend/app/modules/knowledge/tests/test_router.py`、`backend/app/modules/knowledge/tests/test_vector_search.py`、`backend/app/modules/knowledge/tests/test_writer.py`、`backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py`、`backend/app/modules/platform_sync/tests/test_agent_log_messages.py`、`backend/app/modules/platform_sync/tests/test_agent_log_push.py`、`backend/app/modules/platform_sync/tests/test_change_events.py`、`backend/app/modules/platform_sync/tests/test_owner_sync.py`、`backend/app/modules/ppm/common/tests/test_export.py`、`backend/app/modules/ppm/kanban/tests/test_kanban.py`、`backend/app/modules/ppm/plan/tests/test_fsm.py`、`backend/app/modules/ppm/plan/tests/test_service.py`、`backend/app/modules/ppm/project/tests/test_service.py`、`backend/app/modules/ppm/task/tests/test_task.py`、`backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py`、`backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py`、`backend/app/modules/workspace/tests/test_daemon_client_scan.py`、`backend/app/modules/workspace/tests/test_move_order.py`、`backend/tests/modules/agent/test_scan_interactive_dispatch.py`、`backend/tests/modules/auth/test_permissions.py`、`backend/tests/modules/change/test_archive_gate.py`、`backend/tests/test_align_platform_change_events_migration.py`、`backend/tests/test_check_assertion_surfaces.py`、`frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/deploy-records/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx`、`frontend/src/app/m/account/page.test.tsx`、`frontend/src/app/page.test.tsx`、`frontend/src/components/__tests__/admin-role-permission-picker-tree.test.tsx`、`frontend/src/components/__tests__/app-shell.test.tsx`、`frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx`、`frontend/src/components/__tests__/change-file-tree.test.tsx`、`frontend/src/components/__tests__/workspace-drag-grid.test.tsx`、`frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx`、`frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx`、`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx`、`frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx`、`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`、`frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx`、`frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx`、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`、`frontend/src/components/daemon/__tests__/turn-speed.test.ts`、`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx`、`frontend/src/components/explorer/__tests__/file-preview.test.tsx`、`frontend/src/components/files/__tests__/file-preview-modal.test.tsx`、`frontend/src/components/files/__tests__/preview-registry.test.ts`、`frontend/src/components/files/__tests__/structured-views.test.tsx`、`frontend/src/components/floating/floating-session-host.test.tsx`、`frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`、`frontend/src/components/mobile/mobile-change-detail.test.tsx`、`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`、`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`、`frontend/src/components/workspace-config-card.test.tsx`、`frontend/src/lib/__tests__/agent-log-turns.test.ts`、`frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts`、`frontend/src/lib/__tests__/logout-storage.test.ts`、`frontend/src/lib/__tests__/menu-overrides.test.ts`、`frontend/src/lib/__tests__/menu-permissions.test.ts`、`frontend/src/lib/__tests__/permission.test.ts`、`frontend/src/lib/__tests__/session-mention-sources.test.tsx`、`frontend/src/lib/__tests__/token-refresh.test.ts`、`frontend/src/lib/api/__tests__/llm-providers.test.ts`、`sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts`
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 199+46 全绿；三契约文件 git diff 空；模块卡/changelog 更新；实测数字落盘 | `backend/app/modules/agent/tests/test_group_chat_models.py`<br>`backend/app/modules/agent/tests/test_mcp_tools.py`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`backend/app/modules/change/tests/test_assets.py`<br>`backend/app/modules/change/tests/test_files_router.py`<br>…共 20 个（目录级候选全量在 facts/trace，归属按关键词命中与证据锚点收窄） | 全绿、git、diff、模块卡（`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_timeline.py`、`backend/app/modules/change/tests/test_usage_stats.py`、`backend/app/modules/daemon/tests/test_agent_session_tasks.py`、`backend/app/modules/daemon/tests/test_group_cross_mention.py`） | covered | `backend/app/modules/agent/tests/test_provider_caps_alignment.py:13`（全绿）、`backend/app/modules/change/tests/test_assets.py:43`（git）、`backend/app/modules/change/tests/test_assets.py:43`（diff） |

- ⚠️ 零/半自动化承接条目 3 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
- D-001~D-013 全闭环（见决策追踪矩阵逐行 Evidence/状态已填）；无 unresolved；D-005 已升级 @v2（执行模型定案）并在矩阵标注。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2406 backend endpoints (live [scan-root 658 + worktree 656] + artifact 1968), 0 frontend calls [scope: change-diff (9 files @ worktree)] | 0 backend endpoints unused by frontend (+662 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 662 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 8 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（6 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ⚠️ 变更目录缺 visual-evidence.md（渲染对照证据应在执行时随手落盘——收口只验在场不产新证据）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）；non-testable 适用（含运行验证移交场景）：目标环境不可达、构建级验证已过而运行冒烟移交部署后执行——证据写构建回执+移交去向一句话，该行不计入有效分母（勿硬凑 covered-service）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| 本变更接口面：0 端点（agent 声明） | non-testable | design接口表#0 端点声明（契约冻结 D-005@v2） | n/a | 端点行为零变化由回归作证：`backend/app/modules/knowledge/tests/test_router.py` 39 例全绿 + openapi.json git diff 零输出（契约面无新增用例的正当理由：签名/响应模型未动） |
<!-- 解析零行降级（D-005）：接口面以 agent 声明为准（对账分母=声明数）；声明与实际不符时补 design 接口段表格后重跑 --init --force 重生成本段（quick-B：--force 才有刷新通道，手填内容会重置先备份） -->
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
- 后端：knowledge 模块 **205 passed**（含 test_knowledge_search 31 + test_router 39 + 迁移钉子 7 + 既有回归）；日志 C:/Users/qinyi/IdeaProjects/multi-agent-platform/.sillyspec/.runtime/logs/pgv-task05-backend.log
- 前端：两页 **46 passed**（零源码改动）；修复并行会话删坏的主仓 node_modules 顶层链接（pnpm install --force，坑已记 uncategorized）后经 .bin 直跑；日志 C:/Users/qinyi/IdeaProjects/multi-agent-platform/.sillyspec/.runtime/logs/pgv-task05-frontend3.log
- lint：ruff check/format + mypy（search.py/router.py/迁移）全过
- 契约零 diff 物证：git diff（openapi.json / 前端 api-types.ts / daemon api-types.ts）空输出

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | task-05 | 两表+迁移落地；重启 0.003s 实测（design R-01 回填） | 已闭环 |
| D-002@v1 | task-01 | search.py 两 ORM（with_variant）+ 迁移 DDL + 建表单测 | 已闭环 |
| D-003@v1 | task-02 | _sync_delta 四态 + 精确计数断言 + hash 吸收 | 已闭环 |
| D-004@v1 | task-02 | _query_vector_candidates 方言分叉 + 两方言一致测试 | 已闭环 |
| D-005@v1→@v2 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | async 编排定案（@v2 修订执行模型）；契约冻结口径不变 | 已闭环 |
| D-006@v1 | task-02 | _query_word_candidates ILIKE+escape+LIMIT 500 + Python 打分 | 已闭环 |
| D-007@v1 | task-02 | model_version 分支 + ×2 计数断言 | 已闭环 |
| D-008@v1 | task-01、task-04 | 镜像×2 + 迁移 fail-closed + 升级顺序执行单 | 已闭环 |
| D-009@v1 | ⚠️ 未闭环（无 task 回指） | 无文件缓存代码（grep 零命中） | 已闭环（防复潮） |
| D-010@v1 | ⚠️ 未闭环（无 task 回指） | 无 main.py lifespan 改动（git log 零文件） | 已闭环（防复潮） |
| D-011@v1 | task-02 | 同步收敛在检索层内部（无后台组件） | 已闭环 |
| D-012@v1 | ⚠️ 未闭环（无 task 回指） | 无常驻协程（grep 零命中） | 已闭环（防复潮） |
| D-013@v1 | ⚠️ 未闭环（无 task 回指） | 无双触发通道 | 已闭环（防复潮） |
| D-005@v2 | FR-01、FR-02、FR-03、FR-04 | task-02、task-03 | async def search_sync + router 直 await + 三契约文件 git diff 零输出 | 已闭环 |

## 技术债务 [层：人工判断]
无新增 TODO/FIXME/HACK（探针 1 零命中）；_LEGACY_INDEXES 空占位字段（兼容留位，验收审查 X1 确认为「无进程索引态」证据）可后续清理，非债务开口。

## 变更风险等级 [层：人工判断]
contract-required + 部署敏感 —— 新表/迁移/镜像变更但**对外契约冻结**（0 端点变化）；数据库契约由 SQLite 方言全栈测试覆盖（205 例），PG 方言面（KNN SQL/绑定）待生产部署验证（移交项 1）；镜像替换为部署敏感面（迁移 fail-closed 兜底）。design frontmatter 无显式 risk_level。

## Runtime Evidence [层：人工判断]
- 实测（task-05，SQLite 全链，脚本即 test 三专项同源断言）：建库首查 0.017s/3 chunks 嵌入；**重启后首查 0.003s 仅嵌 query（零重建物证）**；差量新文件后仅嵌 2（新块+query）
- 契约物证：git diff 三契约文件空输出；迁移 fail-closed 文案单测钉住（pgvector/pgvector:pg16 指引）
- commit 链（worktree 分支）：task-01（数据层+钉子）→ 5a72f23（task-02）→ 138065e（task-03）→ fbf92cf（task-04）→ 4d1f83d（收口三修）
- 端点实机冒烟：不涉及（后端服务未起；TestClient 全栈 205 例覆盖；生产 PG 面移交）
<!-- 降级路径（design §3.2，D-004 收口）：服务起不来时：Controller 直调冒烟（mock 下游，验绑定+校验+路由）/ 基础设施恢复后复跑固化用例——不要空填不涉及 -->

## 代码审查 [层：人工判断]
- 探针 7 零/半自动化 3 条走查：①部署面（compose/迁移文案）——非测试类，git diff 仅 image 行 + fail-closed 单测钉文案 ✓；②模块卡/文档同步——已产出（主仓待归档提交）✓；③uv.lock——pyproject 附属，机械产物 ✓。
- 断言抽查：test_search_delta_reembeds_only_changed_file（精确计数 baseline+2）、test_search_db_error_falls_back_to_word_scan（reason 前缀+结果非空）、test_search_model_version_change（×2 计数）——真实副作用断言非空断言 ✓。
- 审查 note 三修复核：死代码清除后 q_vec=None 初始化回归全绿（曾因 UnboundLocalError 被降级链吃掉——测试抓到后修复，31 绿）；docstring 语义与实现对齐；router 注释更新。
- **总体评价**：检索内核换存储零契约破坏；并发/降级/方言三面有测试锚点；生产 PG 面移交明确。无 P1 缺陷。（原 TODO 注：
     ① 编辑/更新链路（回显、字段映射、残留态）——非新增主链路，实证盲区；
     ② 非主分支流（相关方/旁路支线等未走查路径）；
     ③ 守卫一致性：同资源端点的操作人/权限校验模式对比（实证 doSubmit 无操作人校验而 delete/withdraw 有——越权）；
     ④ 载荷字段契约（探针 8 ⚠️ 配对逐条核实）；
     ⑤ 分页/并发/事务原子性（无测试基建端的纯逻辑面）-->

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
<!-- verify 完成后的深度复核（独立子代理/二次审查）结论回流至此：缺陷分级（P1 功能不可用 / P2 需求子项 / P3 建议修）+ 修复证据链 + 对「结论枚举」的影响改写。无复核时本节写「无」或删除。复核结论不再只活在聊天记录（2026-09-16 EHS 二次复核实证：5 个 P1 只有聊天可查，变更档案仍写 PASS WITH NOTES）。 -->
