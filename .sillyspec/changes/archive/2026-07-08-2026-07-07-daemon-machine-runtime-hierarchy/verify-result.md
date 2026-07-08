---
author: WhaleFall
created_at: 2026-07-08 11:30:00
change: 2026-07-07-daemon-machine-runtime-hierarchy
stage: verify
---

# 验证报告 — 守护进程运行时页 Machine→Runtime 两级重构

## 结论

**PASS**

10/10 task 全完成，design §5/§6/§7/§8/§9 全一致，全量测试通过（本变更引入的测试 0 失败），0 严重/中等代码审查问题。变更风险等级 contract-required（含 daemon 关键词但 design §14 显式豁免跨进程/生命周期，论证见下）。

## 任务完成度

10/10 task 全 ✅（plan.md checkbox 全勾 + review.json verdict=pass）：

| Task | 产出 | 状态 |
|---|---|---|
| task-01 | schema.py 三 DTO（DaemonMachineRead/ListResponse/Update） | ✅ |
| task-02 | runtime/service.py list_machines/update_machine_alias/_get_owned_instance + DaemonService 委托 | ✅ |
| task-03 | router.py GET/PATCH/POST /machines + _build_machine_read | ✅ |
| task-04 | test_machines_router.py 25 用例 | ✅ |
| task-05 | lib/daemon.ts machine 类型+3 函数 + query-keys.daemonMachines | ✅ |
| task-06 | use-daemon-machines.ts hook（15s 轮询） | ✅ |
| task-07 | runtime-card.tsx + runtime-card-helpers.tsx（从 page 抽出，去 Daemon 版本行） | ✅ |
| task-08 | machine-card.tsx（折叠头+展开体，1:1 对齐 prototype） | ✅ |
| task-09 | page.tsx 两级手风琴重构（D-005 完全替换） | ✅ |
| task-10 | 3 新测试（machine-card/runtime-card/use-daemon-machines）+ page 加强 | ✅ |

## 设计一致性

对照 design.md 全一致：
- §5 后端 API：GET/PATCH/POST /machines 权限/筛选/排序/派生字段/0-runtime/N+1 规避 ✅；现有端点保留（529 passed）
- §6 用量聚合：/machines 不内联，复用 /runtimes/usage，前端按 runtime_id 映射 + 机器头 sum ✅
- §7 前端组件：useDaemonMachines/lib/MachineCard/RuntimeCard/RuntimesPage/query-keys 全 ✅
- §8 操作归属：别名/升级机器级端点；可写目录/会话/审计/启禁/移除 runtime 级 ✅
- §9 决策 D-001~D-007 全覆盖（见追踪矩阵）
- §14 生命周期豁免：不涉及 daemon 注册/心跳/WS 协议、session/lease/agent_run 生命周期变更（复用现有契约）

**合理偏差 3 项**（非错误）：
1. ⚠️ 低：runtime-card 保留别名/升级按钮（design §7.4「Props 与现有 RuntimeCard 一致」保留 vs §8「归属机器卡」上提——内在张力）。page 把 runtime 卡的别名/升级**路由到机器级端点**（功能对齐 §8，因别名/升级本质 instance 级）。视觉冗余但契约正确，建议后续可选清理。
2. ✅ task-02 `list_machines` 签名含 `runtimes_by_instance` dict（N+1 规避 + 对齐现有 list_runtimes_page「service 返 ORM 行→router 转 DTO」分层）。
3. ✅ PATCH/POST 越权返回 404（对齐 `_get_owned_runtime` 避免存在性泄漏，比 design §5.2 理想化的 403 更安全）。

## 探针结果

- **未实现标记扫描**：本变更新增代码无 TODO/FIXME/HACK（grep 确认）。
- **关键词覆盖**：daemon（模块名，§14 豁免不改协议）/ session/lease/agent_run（复用现有，不改生命周期）/ heartbeat（cleanup_stale_runtimes 复用不修改）/ lifecycle（§14 显式豁免）。
- **测试覆盖**：后端 /machines 25 用例（GET 分页/筛选/排序/权限/派生/0-runtime + PATCH 正常/null/404/0-runtime + POST 路由/504/404 + 既有端点回归 6 项）；前端 machine-card 9 + runtime-card 11 + use-daemon-machines 4 + page 加强 4 + 既有 page/usage 适配。
- **决策追踪覆盖**：D-001~D-007 全覆盖（见矩阵）。

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 机器级操作上提 | FR-2,3 | task-02,03,08,09 | /machines mutation 端点 + 机器卡别名/升级按钮 + test_machines_router PATCH/POST 用例 | PASS |
| D-002@v1 状态来源=instance.status | FR-1 | task-01,08,09 | DaemonMachineRead.status + 机器卡状态徽章 + SummaryCard 按 status 统计 | PASS |
| D-003@v1 空机器 | FR-4 | task-01,08 | runtime_count=0/runtimes=[] + machine-card 空态测试 | PASS |
| D-004@v1 用量不内联前端聚合 | FR-6 | task-06,09 | hook 不拉用量 + page getRuntimesUsage + 机器头 sum（machine-card 聚合费用测试） | PASS |
| D-005@v1 完全替换两级 | FR-4 | task-09 | page 无平铺切换 + SummaryCard 机器级测试 | PASS |
| D-006@v1 视觉对齐 prototype | FR-5 | task-07,08,09 | RuntimeCard/MachineCard/page 对齐 prototype（胶囊配色/chevron/排版） | PASS |
| D-007@v1 机器级分页 | FR-1 | task-01,09 | limit/offset 机器级 + PAGE_SIZE=20 + 分页测试 | PASS |

## 测试结果

| 套件 | 结果 |
|---|---|
| backend pytest app/modules/daemon | 529 passed, **2 failed** |
| backend mypy app | Success（421 文件） |
| backend ruff check . | All checks passed |
| frontend pnpm test | 689 passed, 29 todo, 1 skipped（718 总）**0 failed** |
| frontend tsc --noEmit | exit 0 |
| frontend pnpm lint | exit 0（仅存量 warning，均其它模块） |

**2 failed 说明**：`test_allowed_roots_policy_push.py::test_put_allowed_roots_pushes_policy_update` + `test_put_allowed_roots_version_monotonic_across_writes`。execute 阶段 task-04 子代理已用 `git stash -u` 验证：在 base commit `7a2baab5`（本变更前）同样失败。属 baseline 既有 WS policy-push 测试问题，**非本变更引入**（本变更不 touch allowed_roots policy push 逻辑）。verify 阶段不重复 stash（避免改 git 状态）。

## 技术债务

本变更新增代码无 TODO/FIXME/HACK。1 个低级视觉债务：runtime-card 别名/升级按钮冗余（见设计一致性偏差 1，建议后续清理）。

## 变更风险等级

**contract-required**（API contract / DTO / client）

### 为何非 integration-critical（尽管含 daemon 关键词）

design §14 显式声明（生命周期契约豁免）：
1. **不改 daemon 注册/心跳/WS 协议**：`POST /register`、`POST /heartbeat`、`/ws` 全部不动。
2. **不改 session/lease/agent_run 生命周期**：session/lease/agent_run 状态机、事件、转换矩阵全部保留。
3. **升级复用既有 WS 消息**：`POST /machines/{id}/self-update` 复用现有 `daemon:self_update` WS 消息（`router.py:603` 现有 `/runtimes/{id}/self-update` 已在用），**本变更仅改路由键**（instance_id 替代 runtime_id），不新增跨进程通信或事件类型。

实际改动性质：
- 新增 3 个 REST 端点（GET 读 + PATCH 别名 + POST self-update 路由键变更）
- 新增 DTO + 前端 client/组件/page 重构
- 集成路径（WS self-update）已由现有 `/runtimes/{id}/self-update` 验证；本变更换路由键，WS 消息不变，**无新跨进程契约**。

结论：含 daemon 关键词（模块名）但实际不触发真实跨进程集成需求，按 API contract 级验收（contract test 已由后端 25 用例覆盖）。

## Runtime Evidence

风险等级 contract-required（非 integration/deployment-critical），按规则不强制真实启动证据。但提供 contract 级集成证据：

- **POST /machines/{id}/self-update 集成契约**（test_machines_router.py `test_trigger_machine_self_update_*` 4 用例）：
  - mock ws_hub 注入受控 hub，断言 `send_self_update(instance_id, version=latest)` 调用参数含 instance_id（路由键正确）。
  - `send_self_update` 返回 False → 504 DaemonRuntimeOffline（离线/WS 失败映射正确）。
  - 越权/不存在 → 404（归属校验）。
- **既有集成路径未破**：`/runtimes/{id}/self-update`（router.py:603）回归冒烟通过，WS 消息类型不变。
- **daemon 侧零改动**：本变更不 touch `sillyhub-daemon/`（进程协议不动），不存在 daemon 侧集成回归风险。

## 代码审查

**0 严重 / 0 中等 / 1 低级问题**：

| 严重度 | 问题 | 建议 |
|---|---|---|
| ⚠️ 低 | runtime-card 保留别名/升级按钮（design §7.4/§8 张力，功能正确 page 路由机器级，视觉冗余） | 后续可选在 runtime-card 删除以严格对齐 §8，非阻塞 |

安全聚焦审查通过：
- 权限：list_machines admin/普通用户分支对齐 list_runtimes_page；`_get_owned_instance` 越权 404（防存在性泄漏）。
- SQL：q 用 ILIKE 参数化（pattern 传 `.ilike()`），provider 用 EXISTS 子查询，无注入。
- 错误处理：PATCH 404、POST 504（DaemonRuntimeOffline）。
- 架构：后端分层对齐（service 返 ORM 行→router 转 DTO），前端组件化，复用既有模式。

**总体**：生产级实现，可进入 archive。
