# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/knowledge/embedding_worker.py` | 新增（task-01） | 是 |
| backend | `backend/app/modules/knowledge/vector_search.py` | 逻辑变更：embedder 子进程代理化+索引 LRU（task-01） | 是 |
| backend | `backend/app/core/config.py` | 配置变更：新增 3 键（task-01 落 2 键） | 否 |
| backend | `backend/app/modules/spec_workspace/service.py` | 逻辑变更：缓存全局字节帽 LRU（task-02） | 是 |
| backend | `backend/app/modules/daemon/permission_service.py` | 逻辑变更：超时回调新短会话全路径提交（task-03） | 是 |
| backend | `backend/app/modules/daemon/ws_hub.py` | 逻辑变更：泄漏径清理+disconnect 身份校验（task-04） | 是 |
| backend | `backend/app/modules/daemon/router/gateway_misc.py` | 逻辑变更：WS 日志截断（task-05） | 否 |
| backend | `backend/app/modules/session_attachment/router.py` | 逻辑变更：上传 size 预检 413（task-05） | 是 |
| backend | `backend/app/modules/daemon/protocol.py` | 配置/协议变更：新增 change_write_available 常量（task-06） | 是 |
| backend | `backend/app/modules/change/service.py` | 调用关系变更：两落库点 commit 后推送（task-06） | 否 |
| backend | `backend/app/modules/change_writer/proxy.py` | 调用关系变更：落库点推送（task-06） | 否 |
| backend | `backend/app/modules/spec_workspace/router.py` | 调用关系变更：落库点推送（task-06） | 否 |
| backend | `backend/app/modules/agent/model.py` | 数据结构变更：AgentSession.title_fallback 列（task-08） | 是 |
| backend | `backend/migrations/versions/20261016100000_agent_session_title_fallback.py` | 新增迁移+存量回填（task-08） | 是 |
| backend | `backend/app/modules/daemon/router/session_crud.py` | 逻辑变更：列表读列+漏网自愈回写（task-08） | 是 |
| backend | `backend/docker-entrypoint.sh` | 配置变更：oom_score_adj 兜底（task-09） | 否 |
| backend | `backend/app/modules/knowledge/tests/test_embedding_subprocess.py` | 新增（task-01） | 否 |
| backend | `backend/app/modules/daemon/tests/test_ws_hub.py` | 测试扩充 +4（task-04） | 否 |
| backend | `backend/app/modules/daemon/tests/test_permission_http_uplink.py` | 测试扩充 +2（task-03） | 否 |
| backend | `backend/app/modules/daemon/tests/test_session_router.py` | 测试扩充 +3（task-08） | 否 |
| deploy | `deploy/docker-compose.yml` | 配置变更：配额重分配+oom_score_adj（task-09） | 否 |
| sillyhub-daemon | `sillyhub-daemon/src/protocol.ts` | 接口变更：MSG 加 CHANGE_WRITE_AVAILABLE（task-07） | 是 |
| sillyhub-daemon | `sillyhub-daemon/src/daemon.ts` | 逻辑变更：分发 case+兜底节奏门（task-07） | 是 |
| sillyhub-daemon | `sillyhub-daemon/src/config.ts` | 配置变更：change_write_poll_interval=120（task-07） | 否 |
| sillyhub-daemon | `sillyhub-daemon/tests/config.test.ts` | 测试扩充：默认值+键名登记（task-07） | 否 |
| sillyhub-daemon | `sillyhub-daemon/tests/daemon-change-write-push.test.ts` | 新增（task-07） | 否 |
| backend | `backend/Dockerfile` | 配置变更：UV_HTTP_TIMEOUT=300 构建修复（task-10 部署面） | 否 |
| backend | `backend/app/modules/daemon/tests/test_ws_rpc.py` | 测试扩充：旧泄漏断言翻新（task-04，旧断言钉死的是缺陷行为） | 否 |
| backend | `backend/app/modules/session_attachment/tests/test_upload_precheck.py` | 新增（task-05） | 否 |
| backend | `backend/app/modules/spec_workspace/tests/test_bundle_sync.py` | 测试扩充 +3 异步化（task-02） | 否 |
| backend | `backend/tests/test_align_platform_change_events_migration.py` | 测试扩充：迁移链尾锚 head 前移 20261016100000（task-08） | 否 |
| sillyhub-daemon | `sillyhub-daemon/tests/protocol-session-contract.test.ts` | 测试扩充：MSG 钉子 25→26+键值断言（task-07；task 卡旧名 protocol.contract.test.ts 为笔误已修正） | 否 |
| docs | `docs/releases/2026-10-16-008-f62065e2f.md` | 新增：发布记录 008（task-10） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `.zcode/skills/deploy-to-server/SKILL.md`（deploy 运维文档面；.zcode/ 在 .gitignore 未跟踪，不建模块索引，改动随 worktree 提交 0279cd175 留档）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新backend模块卡（本次变更涉及） | done |
| `modules/deploy.md` | 更新deploy模块卡（本次变更涉及） | done |
| `modules/sillyhub-daemon.md` | 更新sillyhub-daemon模块卡（本次变更涉及） | done |
| `_module-map.yaml` | 唯一未匹配=.zcode skill 文档（gitignore 未跟踪），不建索引；无需 rebuild | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

## 归档裁决（archive step2）

- **cannot_verify 草稿 10 条**：execute review runId=exec-2026-10-16-102234-7bd654 为自动草稿兜底态；其证据已由后续两道独立复核兑现——①execute 独立审查（agent-tool，review-2026-10-16-131513 adopted）23 项 checklist 逐卡 pass/pass；②verify 阶段 7/7 完成结 论 PASS WITH NOTES（探针 7 矩阵全 covered/non-testable + 生产四指标实测）。判定：全部 satisfied，无静默放行。
- **module-impact 列而 diff 无的 4 个文档目标**（modules/backend.md、deploy.md、sillyhub-daemon.md、_module-map.yaml）：属「更新结果」表目标（.sillyspec 文档面），不参与代码 diff 对账；三卡已写入（done）、_module-map.yaml 无需变更（无新模块/路径变化）。
- **.zcode/skills/deploy-to-server/SKILL.md**：未匹配文件（.gitignore 游离面），改动随 worktree 提交 0279cd175 留档，不建模块索引。
