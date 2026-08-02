# "daemon → agent → workspace" 三层架构 —— 风险与实施策略评估

> 评估日期：2026-08-02
> 评估人：risk_assessor（基于架构分析师 worker 184c7644 的前置分析 + 本 worker 独立审计）
> 性质：**实施风险评估**，非变更规格。提供结构化判断依据供 Coordinator 收敛决策。
> 评估对象：在现有 "daemon → workspace" 二层绑定之上，插入显式的 "agent profile" 中间层，形成 daemon → agent → workspace 三层架构。

---

## 0. 一句话结论

**不建议在近期（2 个月内）实施完整三层架构改造。ROI 极低，风险远大于收益。** 当前 daemon-entity-binding（2026-07-03 落地）已经是稳定正确的架构基础，真正缺失的不是一个 agent profile 中间表，而是 agent 能力发现与前端展示的体验层。**替代方案（仅加 agent profile 配置层、不改绑定）是更优解。**

---

## 1. 实施范围评估

### 1.1 若做完整三层架构（daemon → agent → workspace），涉及模块清单

| 模块 | 文件 | 改动性质 | 预估改动量 |
|------|------|----------|-----------|
| **数据层** | `agent/model.py`、`daemon/model.py`、`workspace/member_runtimes/model.py` | 新增 `AgentProfile` 表 + `WorkspaceMemberRuntime` FK 从 `daemon_id` 改为 `agent_profile_id` + 迁移 | 🔴 大 |
| **daemon 注册/心跳** | `daemon/service.py`、`daemon/router.py` | 注册时上报 agent profiles、心跳同步 profile 状态 | 🔴 中 |
| **workspace 绑定** | `workspace/member_runtimes/service.py`、`router.py`、`queries.py` | 绑定对象从 daemon_id 改为 agent_profile_id | 🔴 中 |
| **agent placement** | `agent/placement.py`（~900 行） | dispatch 解析链路：workspace → agent_profile → daemon → lease | 🔴 中 |
| **execution** | `agent/execution.py` | dispatch_worker 传递 agent_profile 上下文 | 🟡 小 |
| **borrow** | `agent/borrow_resolver.py` | 借用解析从 daemon 维度改为 agent profile 维度 | 🟡 中 |
| **finalizer** | `agent/finalizer.py` | 无直接改动（收敛逻辑不依赖绑定层），但 agent profile 可能影响 GLM 编排 | 🟢 小 |
| **daemon 端** | `sillyhub-daemon/src/daemon.ts`、`agent-detector.ts` | 注册时上报 agent profiles 列表 + 心跳维持 | 🟡 中 |
| **前端** | workspace config、daemon management、agent console | 绑定界面从"选 daemon"改为"选 agent profile"；daemon 管理页展示注册的 agent 列表 | 🔴 中 |
| **测试** | 50+ 测试文件（grep `daemon_instances` 命中 50 文件） | 适配新 FK + mock + fixture | 🔴 大 |

**合计**：跨 4 端（backend 数据层 + backend 业务层 + daemon + frontend）、至少 15 个核心文件、50+ 测试文件。**这是一个大变更（跨端 + 数据层），不是中等变更。**

### 1.2 当前架构已具备的"三层"隐式表达

```text
当前实际运作方式（数据层面）：
  DaemonInstance (机器)
    └── DaemonRuntime (provider: claude/codex/...)
         └── DaemonTaskLease (执行单元)
              └── AgentRun (一次执行)
                   └── workspace 上下文（通过 WorkspaceMemberRuntime.root_path）

当前绑定关系：
  Workspace × User → WorkspaceMemberRuntime.daemon_id → DaemonInstance
                   → WorkspaceMemberRuntime.root_path → 本地路径

路由规则：
  dispatch_worker → placement.dispatch_to_daemon
    → resolve member binding (workspace_id, user_id) → daemon_id
    → find online daemon_runtime → create lease → daemon polls + executes
```

**关键观察**：`DaemonRuntime`（provider + version + allowed_roots）已经是 agent profile 的雏形。每个 provider 是一个"agent 能力单元"。缺失的不是数据模型，而是**前端展示层**——用户看不到 daemon 上有哪些可用的 agent provider。

---

## 2. 数据库迁移风险评估

### 2.1 迁移复杂度：🔴 高

若引入 `AgentProfile` 中间表，迁移必须处理：

1. **新表 `agent_profiles`**：至少需要 `id, daemon_id(FK), provider, model, version, status, capabilities(JSON), created_at, updated_at`
2. **`WorkspaceMemberRuntime.daemon_id` → `agent_profile_id`**：这是数据迁移的核心难点
   - 旧行：只有 `daemon_id`，没有 `agent_profile_id`。需要反向查找 daemon_instance 下有哪些 runtime，选默认 provider 填进去
   - **数据回填不可靠**：一个 daemon 可能有多个 runtime（claude + codex），选哪个作默认？如果用户之前绑的是 daemon（期望"所有 agent 都能用"），迁移后只能绑一个 profile，语义丢失
3. **`DaemonTaskLease.runtime_id`** 保持不变（lease 仍绑定 runtime，不绑定 agent_profile），但 dispatch 解析路径变长
4. **`AgentRun`** 可能需要新增 `agent_profile_id` 列（当前有 `agent_type` + `provider` + `model` 三列，agent_profile 可替代这三列）

### 2.2 向后兼容性：⚠️ 需要双模式过渡期

**强制一刀切迁移不可行**，原因：
- 生产环境有活跃 daemon 连接，改绑定结构 = 所有 workspace 成员必须重新绑定
- daemon 端需要同步升级（新注册协议），旧 daemon 无法被识别
- 50+ 测试文件依赖当前 FK 结构，测试全量重写成本高

**如果要上，双模式过渡期是必须的**：
- Phase 1：`WorkspaceMemberRuntime` 同时保留 `daemon_id` 和 `agent_profile_id`（nullable），dispatch 优先走 agent_profile，fallback daemon_id
- Phase 2：数据迁移脚本批量回填 `agent_profile_id`
- Phase 3（≥2 周后）：drop `daemon_id` 列

**这个过渡期的代价**：两套解析路径、两套测试、两套文档，维护成本翻倍。历史上 `runtime_id → daemon_id` 的过渡（2026-07-03 daemon-entity-binding）就是前车之鉴——迁移 `202607031301_daemon_runtimes_instance.py` + `202607031302_wmr_daemon_id.py` 分了两个 migration，`WorkspaceMemberRuntime.daemon_id` 至今仍是 nullable（`default=None`）。参考 audit 文档 §5.5：**"待部署验证的 migration（daemon-entity-binding 等）"仍列在 P1 技术债中**——上一个绑定重构的 migration 还没完全验证，不应该立即启动下一个。

---

## 3. 对现有功能的影响

### 3.1 变更流程（change flow）

**影响**：中等。

变更流程的 stage dispatch 走 `service.py:992 start_stage_dispatch` → interactive lease → `placement.py:259`。当前 dispatch 解析的是 user → workspace binding → daemon_id。如果 binding 改为 agent_profile_id，dispatch 路径多一跳（agent_profile → daemon），但不改变核心逻辑。

**风险点**：
- `prepare_scan_interactive_dispatch`（placement.py）需要适配新解析路径
- interactive session 的 daemon 路由（`daemon/session/service.py`）不变，因为 session 绑定的是 runtime（不是 daemon 也不是 agent_profile）

### 3.2 Team mission（multi-agent orchestration）

**影响**：中等。

- `execution.py:dispatch_worker` 中的 placement 调用不受影响（内部走 `_resolve_dispatch_runtime`）
- `borrow_resolver.py` 借用解析当前按 daemon_id 维度查找 shared daemon，改为 agent_profile 维度后借用粒度变细（可以只借某个 agent 而非整台机器），**这是正向收益**
- `mcp_tools.py` 中的 delegate_task tool（主 agent 调 backend 的 MCP tool）需要传递 agent_profile 偏好

### 3.3 Daemon 注册/心跳

**影响**：中高。

- daemon 注册（`daemon/service.py`、`POST /daemon/register`）当前只上报 daemon 级信息 + runtime 列表。改为三层架构后，daemon 需额外上报 agent profile 列表（本质上是 runtime 的再封装），注册 payload 膨胀
- 心跳（`POST /daemon/heartbeat`）需要同步 agent profile 状态（online/offline/busy）
- **daemon 端 agent-detector.ts 的 12 provider 探测**结果需要映射为 agent profile

### 3.4 Per-worker worktree 隔离

**影响**：低。

`execution.py` 中的 `git_worktree_add` 和 `worktree_branch` 字段与绑定层无关。agent profile 不影响 worktree 创建/合并逻辑。

### 3.5 借用（borrow）

**影响**：中等（正向）。

当前借用是 daemon 粒度（借整台机器）。改为 agent profile 粒度后：
- ✅ 更精细：可以只借 claude 不借 codex
- ❌ 复杂度增加：借用 UI 需要展示 agent profile 列表而非 daemon 列表

---

## 4. 实施阶段建议（如果决定做）

```
Phase 0（前置，2-3 天）：修 P0 bug + 验证迁移
  ├── P0-1 修 interactive kill 僵尸
  ├── P0-2 修 MissionControl.cancel 僵尸
  └── 部署验证 daemon-entity-binding 的 PG migration

Phase 1（数据层，3-5 天）：新建 agent_profiles 表 + 双模式过渡
  ├── 新建 agent_profiles 表（daemon_id FK）
  ├── WorkspaceMemberRuntime 加 agent_profile_id（nullable，与 daemon_id 并存）
  ├── 数据迁移：daemon 注册时自动创建 profile；存量 runtime 回填为 profile
  └── 双模式 dispatch（agent_profile → daemon 优先，daemon 直接绑定兜底）

Phase 2（daemon 端，2-3 天）：daemon 注册协议升级
  ├── daemon 注册上报 agent_profiles 列表
  ├── 心跳同步 profile 状态
  └── 向后兼容旧注册协议

Phase 3（前端 + 绑定切换，3-5 天）：
  ├── workspace 绑定 UI：选 agent profile（替代选 daemon）
  ├── daemon 管理页：展示注册的 agent profile 列表
  ├── mission 创建：按 agent profile 选择 worker
  └── 借用：按 agent profile 粒度

Phase 4（收尾，2-3 天）：
  ├── 清理 daemon_id 直接绑定路径（drop 旧列）
  ├── 更新 50+ 测试
  └── 文档 + 部署验证

总计：12-19 天（1 人全力），跨 4-6 周（考虑并行度 + 评审 + 修复）
```

---

## 5. 前置依赖（必须先修）

| 优先级 | 事项 | 依据 | 理由 |
|--------|------|------|------|
| 🔴 P0 | **P0-1 修 interactive kill 僵尸** | audit §2 发现 1、§3 第一层 | 三层架构改了绑定 → dispatch → lease 链路，kill 链路必须正确才能验证新架构（否则改出 bug 无法可靠终止 agent） |
| 🔴 P0 | **P0-2 修 MissionControl.cancel 僵尸** | audit §2 发现 4、§3 第一层 | 同上，mission 级控制必须先正确 |
| 🔴 P0 | **部署验证 daemon-entity-binding migration** | ROADMAP §四、audit §5.5 | 上一个绑定重构（2026-07-03）的 migration 还没部署验证，在此之上再改绑定是对正确性的不负责任 |
| 🟠 P1 | **重跑 scan 再生过期文档** | ROADMAP §四 | 准确理解当前架构才能正确设计新绑定层 |
| 🟡 P2 | **打通只读 team mission（P1-1）** | audit §3 第二层 | 先验证 team 编排全链路正确，再改底层绑定——否则出问题无法判断是编排 bug 还是绑定 bug |

---

## 6. 人力与时间估算

| 维度 | 估算 |
|------|------|
| **backend 数据层** | 3-5 天（model + migration + 双模式 service） |
| **backend 业务层** | 3-5 天（placement + execution + borrow + router 适配） |
| **daemon 端** | 2-3 天（注册协议 + 心跳 + agent profile 上报） |
| **前端** | 3-5 天（绑定 UI + daemon 管理 + mission 配置） |
| **测试** | 3-5 天（50+ 测试文件适配） |
| **文档 + 部署验证** | 2-3 天 |
| **评审 + 修复** | 2-3 天（跨端变更评审周期长） |
| **合计（1 人全力）** | **18-29 天** |
| **合计（2 人并行）** | **12-18 天**（backend + daemon 并行，前端 + 测试串行） |

**保守估计**：4-6 周（含评审、修复、部署验证）。

---

## 7. 替代方案：不改绑定，只加 agent profile 配置层

### 7.1 方案描述

**保持现有 `WorkspaceMemberRuntime.daemon_id` 绑定不变**，新增 `AgentProfile` 仅作配置/展示层：

```text
数据模型（不改绑定）：
  Workspace × User → WorkspaceMemberRuntime.daemon_id → DaemonInstance  ← 不变

新增（只读配置层）：
  DaemonInstance
    └── AgentProfile (daemon_id FK)  ← 新表，daemon 注册/心跳时同步
         ├── provider: "claude" | "codex"
         ├── model: "sonnet" | "opus" | ...
         ├── capabilities: { "interactive": true, "batch": true, "scan": true }
         └── status: "online" | "offline" | "busy"

用途：
  - 前端 daemon 管理页展示 agent 能力列表
  - Mission 创建时展示可选 agent profile（但仍绑 daemon）
  - 借用：可按 agent profile 过滤（但实际借用仍是 daemon 粒度）
  - 未来条件成熟时可平滑升级为真三层架构
```

### 7.2 对比分析

| 维度 | 完整三层架构（改绑定） | 替代方案（仅配置层） |
|------|----------------------|---------------------|
| **实施周期** | 4-6 周 | 3-5 天 |
| **数据迁移风险** | 🔴 高（FK 切换 + 回填 + 双模式） | 🟢 低（新表追加，零迁移） |
| **向后兼容** | ⚠️ 需双模式过渡期 | ✅ 完全兼容，零回归 |
| **对现有功能影响** | 🔴 中高（placement/dispatch/bind 全线改） | 🟢 零影响（新表只读） |
| **测试改动量** | 🔴 50+ 文件 | 🟢 2-3 文件（仅新表测试） |
| **daemon 端改动** | 🟡 注册协议升级 + 心跳 | 🟡 注册时多报一个 profiles 列表 |
| **前端收益** | 绑定粒度更细 | ✅ 同样能看到 agent 能力列表 |
| **未来升级路径** | 一步到位 | ✅ 可随时升级（FK 已就位） |
| **真正解决的问题** | agent profile 绑定粒度 | agent 能力可见性（这才是用户真正缺的） |

### 7.3 推荐：替代方案是更优解

**理由**：

1. **当前架构不缺抽象、缺可见性**：`DaemonRuntime` 已经是 agent profile 的数据载体（provider + version + capabilities）。用户看不到、选不了，是因为前端没展示——不是因为没有 agent profile 表。

2. **绑定层不应该频繁重构**：daemon-entity-binding（2026-07-03）是最近一次绑定重构，migration 还没部署验证（ROADMAP P1 技术债）。在此之上立刻再做一次绑定重构，违反"稳定优先"原则。

3. **真正的高杠杆事项不在这里**：audit 文档列的最高 ROI 路径是 P0-1/P0-2（僵尸 bug）→ P1-1（打通只读 team）→ P1-2/3（前端补全）→ P2-1（预算硬门）→ P2-2（写代码 team）。"agent profile 三层架构"在任何一条路径上都不是前置依赖。

4. **替代方案可随时升级**：新 `AgentProfile` 表带 `daemon_id` FK，未来要改为真三层架构（绑定切到 agent_profile_id），只需要改 FK 引用方向，数据层不需要重新设计。

---

## 8. 风险矩阵总结

| 风险 | 严重度 | 可能性 | 缓解措施 |
|------|--------|--------|----------|
| 数据迁移失败（daemon_id → agent_profile_id 回填不可靠） | 🔴 高 | 中 | 双模式过渡 + 回滚脚本 + staging 环境先验 |
| 旧 daemon 不兼容新注册协议 | 🔴 高 | 高 | 向后兼容注册协议（version negotiation） |
| dispatch 链路 bug（多一跳解析路径） | 🟠 中 | 中 | 充分测试 + placement 单测已较完善（25 测试文件） |
| 生产环境绑定断裂（所有成员需重绑） | 🔴 高 | 中 | 双模式过渡，旧 binding 继续工作 |
| 测试全量重写成本失控 | 🟠 中 | 高 | 分 Phase 迁移测试，先补后改 |
| 与 pending 变更冲突（5 个活跃变更中有借用、worktree 等） | 🟡 低 | 中 | 先归档或完成活跃变更，再启动三层架构 |

---

## 附录 A：关键文件索引（本次风险评估参考）

**数据模型**：
- `backend/app/modules/agent/model.py`（AgentRun / AgentMission / AgentArtifact / AgentRunDependency）
- `backend/app/modules/daemon/model.py`（DaemonInstance / DaemonRuntime / DaemonTaskLease）
- `backend/app/modules/workspace/member_runtimes/model.py`（WorkspaceMemberRuntime）

**编排核心**：
- `backend/app/modules/agent/execution.py`（MissionExecutionService / dispatch_worker）
- `backend/app/modules/agent/placement.py`（RunPlacementService / dispatch_to_daemon）
- `backend/app/modules/agent/finalizer.py`（FinalizerService / finalize_execute_mission）
- `backend/app/modules/agent/borrow_resolver.py`（借用解析）

**部署**：
- `deploy/docker-compose.yml`（三服务架构：postgres + redis + minio + backend + frontend）

**参考文档**：
- `ROADMAP.md`（架构决策：工作区绑定 = daemon 实体）
- `docs/agent-platform-deep-audit-2026-07-12.md`（P0 僵尸 bug + 提升方案优先级）

## 附录 B：与架构分析师（worker 184c7644）的结论一致性

本评估独立审计后，与架构分析师的前置分析一致：**当前绑定架构（daemon-entity-binding）是正确的，不急需重构。优先事项是修 P0 bug + 打通已写好的能力（只读 team mission），而非引入新的架构层次。**
