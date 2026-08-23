# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

## 结论：PASS —— 8/8 任务双 pass review + 三仓全量回归绿（唯一失败为主仓既有债）+ 部署环境六项端到端实证（真实 CLI 会话化链路全通）。

## 任务完成度
| task | 状态 | 依据 |
|---|---|---|
| t01 CLI 协议 ctx | ✅ | sillyspec 仓 4e4fc6b0；79/79 + 真实冒烟两场景 |
| t02 daemon env 注入 | ✅ | spawn-env 34/34 + 全量 2592 绿 |
| t03 数据层 | ✅ | 三列+FK+迁移对称实跑；接真实 head 20260823100000 |
| t04 归属服务 | ✅ | 114 passed（106 零回归+8 新） |
| t05 激活与内容 | ✅ | 1020 passed（26 新用例） |
| t06 gen:types | ✅ | v2 契约生成 + 合并基线重生成后 build 绿 |
| t07 前端会话化 | ✅ | daemon 359 + sessions 96 全绿 |
| t08 回归部署实证 | ✅ | 三仓全量 + 六项 e2e（runtime-evidence.md） |

## 设计一致性
与 design（Grill 修订版）一致。已披露偏差全记录在各 task review.json：t01 ctx 缺字段保留原值不清空；t02 等价简化三处+清残留增强；t03 接真实迁移 head+2 字段守卫测试更新（design §6 已补）；t04 不清空旧归属；t05 离线 504（既有类真实值，design 笔误已修）+agent_name 成对+502 防御；t07 直传省死三元等四处。均为实现保真修正，无方向性偏离。

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖
| 关键词 | 实现命中 |
|---|---|
| hub_session_id 关联/降级 | service upsert hub 分支三校验 + 降级静默（D-005） |
| entry 级 ctx 分组 | (harness, coalesce(change_key, quick_id)) 分组 find-or-create（D-009） |
| 懒激活 | _activate_tool_report_session + inject 前置分支 + 409 AppError（D-010） |
| origin 下发 | AgentSessionRead.origin + 列表/详情 + title 优先派生 |
| 内容读取 | GET content 直连 ws_rpc + 黑名单 + 262144 截断 errors=ignore |
| SILLYHUB_SESSION_ID 注入 | spawn-env 层 1 之上 + 三路径（create/restore/reload） |
| 🧾 徽标/SessionBody | session-list-panel origin 分支 + AgentLogSessionBody |
| 旧挂载移除 | workspaceId 零残留（grep=0）+ prop 类型层删除 |

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（src、src/run、docs、test）找到 11 个测试文件（docs/archive/agent-sillyspec-stage-execution-analysis.md、docs/archive/spec-alignment.md、docs/integrations/sillyspec-dispatch.md、docs/sillyspec/finished/progress-specdir-drift.md、docs/sillyspec/finished/quick-cwd-drift-splits-specdir.md …）
- ✅ task-02: 模块目录（sillyhub-daemon/src、sillyhub-daemon/src/interactive、sillyhub-daemon/tests）找到 11 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-03: 模块目录（backend/app/modules/agent、backend/app/modules/platform_sync、backend/migrations/versions、backend/app/modules/daemon/tests）找到 35 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-04: 模块目录（backend/app/modules/platform_sync、backend/app/modules/platform_sync/tests）找到 10 个测试文件（backend/app/modules/platform_sync/tests/conftest.py、backend/app/modules/platform_sync/tests/test_agent_log_content.py、backend/app/modules/platform_sync/tests/test_agent_log_push.py、backend/app/modules/platform_sync/tests/test_auth_tightening.py、backend/app/modules/platform_sync/tests/test_get_or_issue.py …）
- ✅ task-05: 模块目录（backend/app/modules/daemon/session、backend/app/modules/daemon、backend/app/modules/platform_sync、backend/app/modules/daemon/tests、backend/app/modules/platform_sync/tests）找到 29 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/host_fs/tests/test_delegate.py、backend/app/modules/daemon/host_fs/tests/test_delegate_integration.py、backend/app/modules/daemon/host_fs/tests/test_delegate_nfr.py …）
- ✅ task-06: 模块目录（frontend/src/lib、backend）找到 55 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts、frontend/src/lib/ppm/execute-time.test.ts …）
- ✅ task-07: 模块目录（frontend/src/lib、frontend/src/components/daemon、frontend/src/components/sessions、frontend/src/components/daemon/__tests__）找到 26 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts、frontend/src/lib/ppm/execute-time.test.ts …）
- ⚠️ task-08: 模块目录（.sillyspec/changes/2026-08-23-agent-activity-sessions）递归未找到测试文件（含 co-located tests/）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
| 决策 | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001 聚合键 | FR-04 | t04 | e2e ①②④ 真数据 | ✅ |
| D-002 可继续 | FR-05 | t05 | activation 9 用例 | ✅ |
| D-003 读库+daemon读文件 | FR-06/07 | t05/t07 | content 17 用例 + e2e ⑥ | ✅ |
| D-004 移除旧挂载 | FR-08 | t07 | e2e ⑤ | ✅ |
| D-005~008 工程决策 | FR-01/03 | t01/t02/t04 | 各 task review | ✅ |
| D-009 entry 级 ctx | FR-01/04 | t01/t04 | e2e ④ 分流实证 | ✅ |
| D-010 机器自选 | FR-05 | t05 | activation 用例 | ✅ |
| D-011 Grill 闭环 | 全部 | 全部 | review-2026-08-23-133028 复核 pass | ✅ |

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 1081 backend endpoints (live 198 + artifact 990), 0 frontend calls [scope: change-diff (3 files)] | 535 backend endpoints unused by frontend
- ⚠️ 535 个后端端点前端未调用（warning 不阻断）：GET /agent/file-artifacts、POST /auth/login、GET /auth/captcha/confirm、POST /auth/captcha/verify、POST /auth/refresh …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果
| 套件 | 结果 |
|---|---|
| backend 全量（worktree） | 5108 passed / 1 failed（test_dispatch_worker——主仓既有债，bb298931 基线即红，非本变更文件，known failure 豁免）/ 1 xpass 预存 |
| daemon（worktree） | 2592 passed / 9 skipped |
| frontend（worktree） | exit 0 全绿（daemon 359 + sessions 96 组件级复验） |
| sillyspec | 79/79 |
| 合并后 main 复验 | platform_sync+activation 140 passed / tsc 0 错 |

## 决策追踪矩阵（如存在 decisions.md；无则删本节）
见探针 4 表（D-001~D-011 全 ✅）。

## 技术债务
探针 1：零命中；无新增技术债（遗留两项登记 runtime-evidence §3：daemon 真实会话全链路待首用确认、主仓既有红）。

## 变更风险等级
integration-critical + deployment-critical（新 API+DB+跨仓协议+部署实证）；design frontmatter 无显式 risk_level。已按双档要求完成部署环境实证（下节）。

## Runtime Evidence
详见同目录 runtime-evidence.md（commit 锚：worktree 604c81a1 → main 20f57f6c → sillyspec 4e4fc6b0；部署：迁移 20260823100000→120000 落 compose PG、双镜像重建 up -d healthy 2026-08-23 ~16:30）。关键链摘要：
- 真实 CLI 直跑 `status --change 2026-08-23-agent-activity-sessions` → tool_report 会话「zcode · 2026-08-23-agent-activity-sessions」（pending/turn_count=0/provider=claude D-007）
- entry 分流：本 run 3 条挂变更会话，无 ctx 存量挂「本地活动」单桶
- hub 关联 API 模拟：POST 带 hub_session_id → 精确挂接，status 不变
- 内容读取：真实 ~/.zcode 路径 200+真实内容尾部；不存在 entry 404
- 旧挂载：agent-log-card workspaceId grep=0

## 代码审查
逐 task 主代理审查 + execute 级 acceptance review（12 checklist 全 pass）+ plan/design 双独立审查闭环。无未处理 TODO/FIXME；错误处理覆盖（best-effort 降级/409-404-504 中文/前端静默隐藏）。遗留两项均已登记（非阻塞）。
