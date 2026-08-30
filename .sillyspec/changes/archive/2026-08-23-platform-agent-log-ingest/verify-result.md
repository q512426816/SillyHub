# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节已由 QA（主代理）逐项填写。

## 结论：PASS —— 5/5 任务双 pass review + 三端全量回归绿（唯一失败项均为主仓既有债或已按意图修复）+ 真实 CLI 端到端实证（推送落库 + GET 回读）+ 合并后回归绿。

## 任务完成度

| task | 状态 | 依据 |
|---|---|---|
| task-01 模型层 | ✅ | AgentSessionLogORM（18+2 列 + uq(workspace_id,log_path)）落 main（4e661bc6）；alembic 单头 20260823090000 实证；platform_sync 套件 94+12 passed |
| task-02 接口层 | ✅ | POST/GET /api/agent-logs 落 main；12 新用例（鉴权矩阵/幂等/去重/跨 ws/422/GET scope+排序+limit）全绿；ruff/mypy 干净 |
| task-03 类型同步 | ✅ | api-types.ts 命中 /api/agent-logs（:8301）+ AgentLog* 五 schema；合并后重跑 gen:types **幂等零漂移**（含并行变更 owner_name 共存） |
| task-04 前端面板 | ✅ | AgentLogCard 三态卡片 + 6 用例；daemon 目录合并后 340 测试零回归；tsc 0 错 |
| task-05 回归+实证 | ✅ | runtime-evidence.md：backend 5024 passed / frontend 1923 passed；真实 CLI 推送 → platform_agent_logs 3 行 zcode 条目 → GET 回读齐全 |

## 设计一致性

与 design.md 一致（含 4 处已在 task review 披露并接受的实现偏差）：

- task-04：测试文件落 `__tests__/` 目录（项目惯例）；挂载加 wrapper div（防 flex 压缩，对齐 TeamTaskBlock 惯例）；「调用 N 次」null 兜底常驻渲染；刷新按钮用原生 button（段族惯例）。
- task-05：2 个越界测试修复（`test_alembic_single_head_chain` / `test_migration_is_single_head_after_mount`）——断言从「REVISION_ID 必须是 head」按测试意图放宽为「单 head 且 REVISION_ID 在链上」；其中一个为主仓既有红（head 已推进到 20260822090000 后仍断言 2026082113000），一并修复。
- 其余（鉴权矩阵语义、upsert 键与整行覆盖、NULLS LAST、snake_case 响应、extra=ignore、entries 1..50、log_path max_length、query key 工厂、dayjs extend）与 design §3 逐条一致。

## 探针结果（CLI 机械预填）

#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖（QA 执行）

| 关键词 | 实现命中 |
|---|---|
| upsert/幂等 | service.upsert_agent_log_entries（dict 保序去重 + 整行覆盖，D-005） |
| fail-closed 403 | router.py push_agent_logs scope.workspace_id None → 403「缺少工作区归属」 |
| NULLS LAST | service.list_agent_logs `desc().nulls_last()`（X-07） |
| 复制交互 | agent-log-card.tsx useCopyFeedback（900ms「已复制 ✓」） |
| 三态/折叠 | COLLAPSED_COUNT=3 + 展开全部；空态文案；error→null |
| workspace 守卫 | session-panel.tsx `{session.workspace_id ? <AgentLogCard/> : null}`（D-006） |
| shpsync_/token 派生 | 复用 require_platform_sync_write（auth.py 三路分流零改动） |

#### 探针 3：验收标准测试覆盖
- ✅ task-01/02/03/04 模块目录均含新测试文件（机械预填见上）
- ⚠️ task-05 无测试文件（验证型任务，本质属性；产物为 runtime-evidence.md）
- 集成盲区标注：跨 task 交界（t02 端点 ↔ t03 类型 ↔ t04 消费）由 **e2e 真实链路**覆盖（CLI→8010→PG→GET）；组装行为由合并后 main 全量回归覆盖（tsc/daemon 340/后端 135）。
- 断言有效性抽查：test_agent_log_push 幂等用例断言「仍一行 + invocations 更新 + created_at 保留」（非仅状态码）；GET 排序用例构造两行不同 last_seen_at 断言顺序——均为行为断言非烟雾。

#### 探针 4：决策追踪覆盖（QA 执行）

| 决策 | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001 落位 platform_sync | FR-01 | t02 | router 挂既有 router 无新 prefix | ✅ |
| D-002 结构化列无 payload | FR-02 | t01 | model.py 无 JSON payload 列 | ✅ |
| D-003 时间 String 原文 | FR-02/03 | t01/t02 | String(64)×3 + 字符串排序 | ✅ |
| D-004 GET scope 复用 | FR-03 | t02 | _read_args + 组合过滤 + 越权空列表测试 | ✅ |
| D-005 整行覆盖不累加 | FR-02 | t02 | upsert 分支 + 幂等测试断言 | ✅ |
| D-006 面板挂 SessionPanelPage | FR-04 | t04 | 单点插入 + null 守卫 | ✅ |
| D-007 无 TTL | — | — | 表无清理任务（量级 ≤10/ws） | ✅ |
| D-008 Grill 结论 | 全部 | 全部 | X-04/05/06/07/08/15/17/20 修正项全部体现在实现 | ✅ |

#### 探针 5：API Contract Parity
- ❌ 探针报 143 missing —— **判定为工具误报（非本变更缺陷）**：对账基线 endpoints.json 陈旧/失配，连 `GET /api/workspaces`、`POST /api/auth/login` 等主仓存在多年的端点也全部误报 missing。本变更相关两端的**权威核验**：`backend/openapi.json` 含 `/api/agent-logs`（6 处命中）；前端 `agent-logs.ts:34` 调用路径一致；合并后 `pnpm gen:types` 幂等零漂移；e2e GET 真实返回 200。POST 端点消费方是 SillySpec CLI（非前端），e2e 已证。
- ⚠️ 784 后端端点前端未调用（warning，历史面，不阻断）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录

## 测试结果

| 套件 | 结果 | 备注 |
|---|---|---|
| backend 全量（worktree，`pytest -q --no-cov -n auto`） | 5024 passed / 3 failed | 3 failed 处置：2 个单头断言按意图修复后复绿（29 passed）；1 个 `test_dispatch_worker_calls_placement_with_role_and_tool_config` **主仓 bb298931 基线本就红**（不涉本变更文件，不修——见技术债务） |
| backend platform_sync + 修复测试（main 合并后） | 135 passed | 含并行变更共存验证 |
| frontend 全量（worktree） | 178 文件 / 1923 passed | |
| frontend daemon 目录（main 合并后） | 340 passed | 含并行变更预会话态测试共存 |
| tsc / lint | 0 error / exit 0 | lint 余 1 条既有 warning（`partial` 未用，非本变更文件） |
| gen:types 幂等（main 合并后） | 零漂移 | 含并行变更 owner_name 共存 |

## 决策追踪矩阵

见探针 4 表（D-001~D-008 全部 ✅，无 unresolved/superseded 引用）。

## 技术债务

- 主仓既有红 `tests/modules/agent/test_execution.py::test_dispatch_worker_calls_placement_with_role_and_tool_config`（bb298931 复现，agent 派发 placement 域）——建议归属方另行处理，本变更未触碰该域。
- 探针 5 的 endpoints.json 对账基线失配（全量误报）——sillyspec 工具缺陷，建议记录到 docs/sillyspec/ 活跃坑。
- Docker 8001/3001 栈在本报告时点仍运行旧镜像（重建中），部署后验证见 Runtime Evidence 增补。

## 变更风险等级

integration-critical（新增 API + DB 表 + 前端消费，跨三端组装）；design frontmatter 无显式 risk_level。已按 integration 级要求完成端到端实证（下节）。

## Runtime Evidence

详见同目录 `runtime-evidence.md`（完整命令与输出摘要）。关键链：

- 迁移：compose PG `20260822090000 → 20260823090000`（2026-08-23 ~10:30，纯增量新表）
- 真实推送：本地仓 CLI（含 agent-log 功能）`status` → worktree 后端 :8010 → `platform_agent_logs` 落 3 行（harness=zcode、format=zcode-model-io-jsonl、size 165KB/387KB/6.9MB、workspace_id=token 派生 b97f8231-…）
- GET 回读：`/api/agent-logs?limit=2` + Bearer shpsync_ → 2 条字段齐全（limit 生效、snake_case）
- 无凭据 401 / shk_live_·JWT 403（pytest 矩阵 + 手动 401 复核）
- commit 锚：worktree a40de8f7 → main 4e661bc6（16 文件 +2385/-11；与并行变更 74131aa5/bb298931 三方合并零冲突）

### 部署后验证（已回填 ✅）

- Docker backend/frontend 镜像自主仓 4e661bc6 重建并 up -d（2026-08-23 02:49，两容器 healthy）。
- `POST /api/agent-logs` 无凭据 → **401**（旧镜像 404，容器日志留痕）；真实 CLI（本地仓）无 env 覆盖直推 local.yaml 的 8001 → 容器日志 `POST /api/agent-logs 200 OK`。
- **upsert 心跳实证**：既有 3 行 `invocations` 1→2、`last_seen_at` 前进至 02:50:13Z——(workspace_id, log_path) 幂等覆盖语义在部署环境成立。
- 前端 3001 healthy（面板客户端渲染自已验证的 GET 通道；组件行为由 vitest 6 用例锁定）。

## 代码审查

- 主代理逐 task 审查（review.json × 5 全 pass）+ 合并后抽查：鉴权路径零新开（复用 auth.py）、服务层事务边界清晰（单 commit）、前端类型全走生成物（无手写接口）、注释密度与模块先例一致。
- 无未处理 TODO/FIXME；错误处理：CLI best-effort（warn 不阻断）+ 服务端 2xx/4xx 语义明确 + 前端 error 静默隐藏卡片（增强信息不干扰主体验）。
- 冗余检查：schema 五模型无重复定义；service 两方法无死代码；wrapper div 为布局必需。
