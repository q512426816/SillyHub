# ROADMAP — SillyHub / multi-agent-platform

> 多智能体协作管理平台。本文件是项目的"单一全貌"：做过什么、在做什么、待做什么。
> 维护规则：每次 `sillyspec-archive` 归档变更时同步更新「已完成里程碑」与「当前活跃」两节。
> 详细变更规格见 `.sillyspec/changes/`（活跃）与 `.sillyspec/changes/archive/`（历史）。

最近更新：2026-07-12

---

## 一、已完成里程碑（按时间，提炼自已归档变更）

### 2026-05 · 平台 bootstrap（14 个变更）

- 多智能体平台 v2 bootstrap + 平台原生 SillySpec 集成
- 核心抽象落地：Agent Adapter、Change Writer、Execution Coordinator、Tool Gateway、Workflow State Machine
- 基础设施：Agent Log Streaming、SSE 可靠流、本地执行循环、Server Sandbox Runner、知识生命周期
- 工作区即组件（component-as-workspace）、工作区 intake spec bootstrap

### 2026-06 上半月 · daemon 重写 + Agent 执行统一（约 15 个变更）

- **daemon 从 Python 重写为 Node.js**（`sillyhub-daemon/`，ESM/pnpm）—— 架构拐点
- daemon Codex 支持、daemon interactive session、unified-agent-execution、agent-runtime-selection
- session history 增强、PPM 数据/模块迁移 + 前端对齐

### 2026-06 下半月 · 用户 / 权限 / 组织 / 服务化（约 25 个变更）

- 用户管理 v2、workspace members、admin 全局 daemon/workspace 管理、admin users/org tree
- 菜单驱动权限（10 task）、daemon-api-key 端到端、本地 daemon、daemon-agent-detection 扩展 12 provider
- quick-chat 多轮、kanban/gantt UI、前端错误处理、interactive idle timeout 修复、concurrent-refresh-revoke
- **daemon-service-split**（DaemonService 3324 行拆 5 子包）、**daemon-network-resilience**（W1/W2/W3 网络韧性）
- daemon-client spec sync fix、username login、ppm 前端对齐、frontend-style-system

### 2026-07 · 平台化 + 类型迁移 + team 主 agent 编排（15 个变更）

- **decouple-scan-from-change-flow**：scan 从变更流程移除，5 段阶段定型（brainstorm/plan/execute/verify/archive）
- **changes-align-sillyspec**：变更中心对齐工具契约（删 propose/quick/human_gate 投影）
- **daemon-entity-binding**：工作区绑定从 runtime 改 daemon 实体（新建 daemon_instances 表）—— 数据层大重构
- **workspace-config-flow**：工作区配置流程重设计（per-member binding + 路径可编辑 + 文档双向缓存）
- **daemon-version-management**：daemon 版本可见 + 远程升级入口
- **daemon-client-change-binding-fix**：daemon-entity-binding 写回层 4 处遗漏修复
- **agent-log-type-tags**：AgentRunLog 加 tool_kind 列 + 前端工具筛选
- **frontend-openapi-types** + **fix-frontend-type-divergence**：手写类型 → OpenAPI 生成类型
- workspace-config-card、daemon-client-spec-sync-strategy、daemon-filesystem-policy（FilesystemPolicyEngine）
- spec-import-async-and-change-reparse、runtime-allowed-roots-config、scan-docs-tree-search
- **2026-07-12-team-main-agent-orchestration**（v2，接管 v1 `2026-06-19-multi-agent-orchestration`）：team 主 agent 真 agent 动态编排（daemon interactive lease + MCP tool 反向调 backend）+ worker 用户预设 + 三重收敛（worker 全终态/主 agent 自主/budget 硬截断 OR）+ GLM fallback + mode=single 零回归。daemon 内置 stdio MCP server 5 tool（P0 鉴权 apiKey X-API-Key）+ backend OrchestratorService/mcp_tools 5 endpoint + frontend TeamConfigPanel/team-progress。12 commit main（c41608be~79417e53 + P1 7369903b）。遗留：AC-9 e2e 真部署验证 + task-04b per-worker worktree 拆新变更

---

## 二、当前活跃变更（5 个）

| 变更 | 状态 | 下一步 |
|---|---|---|
| `2026-06-28-daemon-subagent-transcript` | W1 完成（task-01/02，commit b9dee2e0） | task-03 partial 分桶（R-02 P0）+ 后续 W2/W3 |
| `2026-06-19-multi-agent-orchestration`（v1） | 核心闭环 merge（d16e13c7），Wave0 + 通用兜底已落地 | **被 v2 接管并归档**（team-main-agent-orchestration 已 archive 2026-07-12，v1 Wave3-5 由 v2 实现） |
| `2026-06-04-fix-agent-driven-change-center-flow` | complete_stage 闭环修复（部分） | 补 verify-result 后归档 |
| `frontend-api-fix` | progress 卡在 worktree（macOS 路径残留 `/Users/qinyi/SillyHub/`） | 评估是否已被后续变更覆盖；续作或归档 |
| `qa-fix-round1` | progress 卡在 worktree（macOS 路径残留） | 同上，评估后续作或归档 |

---

## 三、短期计划 / 下一步重点

1. **daemon-subagent-transcript 推进**：完成 partial 分桶 + 三端 transcript 沉淀
2. **multi-agent-orchestration delegate_task spike**：运行时验证 delegate 链路
3. **frontend-api-fix / qa-fix-round1 处置**：核实是否已被后续变更覆盖，决定续作或归档
4. **第 3 批文档救火**（本次审查识别，待单独走变更）：
   - 重跑 scan 再生 5 套过期 scan 文档（source_commit `ba87eec` → HEAD `2d00d069`，跨过 daemon-entity-binding 重构）
   - 恢复 sillyspec.db 进度跟踪或显式接受"以目录为准"

---

## 四、已知技术债 / 风险

| 债务 | 严重度 | 说明 |
|---|---|---|
| scan 文档全量结构性过期 | 🔴 P0 | 5 套 scan 都停在 ba87eec，影响归档/影响分析/模块边界判断 |
| sillyspec.db changes 表为空 | 🔴 P0 | 进度跟踪系统失效（2026-07-03 重建 db 后未关联既有目录），`status/continue/resume` 失灵 |
| SillyHub/multi-agent-platform 双视图文档重复 | 🟠 P1 | `projects/*.yaml` 定义了两个 project 都指向同一仓库，scan 各生一套 docs，modules/flows/glossary 三套重叠 |
| 待部署验证的 migration | 🟠 P1 | daemon-entity-binding 等变更的 PG migration 待 apply + 端到端部署验证 |
| test_member_runtimes 等测试债 | 🟡 P2 | daemon-entity-binding / agent-log-type-tags 变更遗留的少量测试债 |
| `docs/sillyspec/finished/` 21 份工具 bug | 🟡 P2 | 性质属 sillyspec 上游 issue backlog，错配在本仓库 docs/ 下 |

---

## 五、关键架构决策（累计）

- **5 段变更流程**：brainstorm → plan → execute → verify → archive（scan/propose/quick 已移除）。状态机定义：`backend/app/modules/change/model.py` `StageEnum`
- **三服务架构**：frontend（Next.js）+ backend（FastAPI）+ sillyhub-daemon（Node.js 本地守护进程）。部署：`deploy/docker-compose.yml`
- **工作区绑定 = daemon 实体**（非 runtime）：`daemon_instances` 表，per-daemon WS + dispatch daemon_id。runtime 退化为 daemon 的从属
- **provider 抽象**：Claude / Codex 经 `adapters/` 多协议 + interactive driver 抽象，新增 provider 加 driver 不触碰控制面
- **数据层**：PostgreSQL + Redis（Pub/Sub），AgentRun + DaemonTaskLease 编排
- **类型生成**：前端手写类型 → OpenAPI 生成类型（`api-types.ts`），react-query + zustand 并存
