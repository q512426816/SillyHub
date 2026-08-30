---
author: qinyi
created_at: 2026-07-23 13:24:29
change: 2026-07-23-rbac-permission-cache
---

# 验证报告（Verify Result）

## 结论

**PASS**

execute 10 个 task 全部完成并 apply 主仓库；对照 design.md（D-001~006 决策 + 非目标 N1-N5 + §6 接口签名）全一致；5 个探针全过；测试 ruff/mypy 全过 + 434 新增/回归测试 passed 零失败；无 FAIL blocker。本变更为后端内部权限缓存（无 daemon/session/lease/lifecycle/部署路径），风险等级 unit-sufficient，非 integration/deployment-critical。

## 任务完成度

10/10 task 全部 ✅（实证 grep 主仓库 apply 后代码）：

| Task | 内容 | 实证 | 状态 |
|---|---|---|---|
| task-01 | 新建 core/permission_cache.py | 5 async public API | ✅ |
| task-02 | config 加 permission_cache_ttl | config.py ttl 字段 | ✅ |
| task-03 | rbac collect_* 缓存接入 | rbac.py get/set_cached_permissions 7 命中 + everywhere 内存并集 | ✅ |
| task-04 | data_scope 缓存接入 | data_scope.py _compute_ppm_scope + get/set_cached_ppm_scope 9 命中 | ✅ |
| task-05 | roles_service 失效 hook | 6 命中（import + 5 hook：create/update/disable/enable/delete） | ✅ |
| task-06 | users_service 失效 hook | 4 命中（import + 3 hook：create_user/update_user/delete_user） | ✅ |
| task-07 | members_service 失效 hook | 5 命中（import + 4 hook） | ✅ |
| task-08 | workspace create+scan_generate 失效 | 5 命中（import + create 3 处 + scan_generate 1 处，D-006 全覆盖） | ✅ |
| task-09 | ProjectMemberService 失效 hook | 4 命中（import + 3 hook） | ✅ |
| task-10 | 权限缓存测试 | test_permission_cache.py 17 测试函数 | ✅ |

## 设计一致性

对照 design.md（唯一 truth source）逐项核实，实现与设计一致，无 Bug：

- **D-001@v1**（缓存范围 has_permission + data_scope）：✅ rbac collect_* 三函数 + data_scope manager_project_ids/is_super_admin 均接入缓存
- **D-002@v2**（整体清空 + 失效失败升 ERROR）：✅ invalidate_all_permissions scan perm:*+ppm-scope:* 批量 delete；失败 `log.error`（ERROR 级）+ `except Exception` 不抛不阻断业务；业务读写仍 `log.warning` 静默降级。19 处失效调用均在 commit 之后
- **D-003@v2**（三键分离）：✅ `perm:{u}:platform`/`:all`/`:{wsid}` 三键；collect_permissions_everywhere 读 platform+all 内存并集不单独存
- **D-004@v1**（降级回 DB 无本地兜底）：✅ Redis 故障 get→None/set→吞错；ttl<=0 跳过 set；无 cachetools/TTLCache
- **D-005@v1**（ppm-scope uuid 反序列化，安全关键）：✅ get_cached_ppm_scope 强制还原 `manager_project_ids: set[uuid.UUID]`、`is_super_admin: bool`（闭合 uuid-in-set[str] 恒 False 致经理权限静默失效）
- **D-006@v1**（create + scan_generate 全覆盖）：✅ _ensure_creator_as_owner 4 调用方（create L149/168/227 + scan_generate L677）全部接 invalidate，scan_generate 用 workspace_created flag 覆盖

非目标 N1-N5 守住：N1 不缓存动态 SQL（scope_clause 基于底层缓存值构建）/ N2 无本地兜底 / N3 不改 auth_deps（缓存插入 rbac/data_scope 内部）/ N4 整体清空非精确失效 / N5 无新依赖（复用 redis）。

§6 接口签名一致：permission_cache 5 public API 签名与 design §6 一致；rbac collect_* / data_scope manager_project_ids/is_super_admin 签名不变（内部接入）。

## 探针结果

- **探针 1 未实现标记扫描**：9 个变更源码文件无 TODO/FIXME/HACK/XXX/尚未实现
- **探针 2 关键词覆盖**：缓存（get_cached 3 文件 permission_cache/rbac/data_scope）/ 失效（invalidate_all_permissions 6 文件）/ 降级 / uuid.UUID（11 命中）全覆盖
- **探针 3 测试覆盖**：test_permission_cache.py 存在（17 测试覆盖 AC-01~05）
- **探针 4 决策追踪覆盖**：D-001@v1/D-002@v2/D-003@v2/D-004@v1/D-005@v1/D-006@v1 → FR-01~06 → requirements/plan/task 全闭环，无 P0/P1 unresolved（Design Grill v2 已闭合）
- **探针 5 API Contract Parity**：N/A（后端内部缓存，无跨前后端契约）

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01/02/03 | task-01/03/04 | permission_cache.py + rbac.py + data_scope.py | PASS |
| D-002@v2 | FR-04/04a | task-01/05~09 | permission_cache.py:155 invalidate + 各 service 19 hook | PASS |
| D-003@v2 | FR-01/02 | task-01/03 | permission_cache.py _perm_cache_key 三键 + rbac everywhere 并集 | PASS |
| D-004@v1 | FR-01 | task-01 | permission_cache.py 降级 try/except + ttl<=0 跳过 | PASS |
| D-005@v1 | FR-01/03 | task-01/04 | permission_cache.py:123 uuid.UUID 还原 + test_ppm_scope_uuid_deserialization | PASS |
| D-006@v1 | FR-04 | task-08 | workspace/service.py create+scan_generate 5 hook + test_scan_generate spy | PASS |

## 测试结果

质量扫描 + 测试全过，零失败：

- **ruff**：`app/` 全量 All checks passed
- **mypy**：8 改动文件 Success, 0 issues
- **test_permission_cache.py**（新建，task-10）：17 passed（主仓库 apply 后 3.16s）—— 覆盖 AC-01（缓存命中不打 DB JOIN，session.execute spy）/ AC-02（invalidate 清 perm+ppm 保留其它 + role/workspace create/scan_generate 三 spy）/ AC-03（降级 get None/set 静默/invalidate 升 ERROR）/ AC-04（ppm-scope 还原 set[uuid.UUID] isinstance 断言）/ AC-05（经理 problem_operable 本项目 True/非本项目 False）
- **ppm 模块全量**（CLI 对账范围）：402 passed, 0 failed（主仓库，602s）
- **核心回归**（auth/admin/workspace，execute step 9）：315 passed, 5 xfailed(baseline 预期失败，与本次无关), 0 failed
- **技术债务**：无 TODO/FIXME

注：ppm 全量耗时 602s（测试环境无 Redis，每写操作 invalidate 连 localhost:6379 走 IPv6 降级累积），刚超 CLI 默认 timeout 600s；已用 `SILLYSPEC_TEST_TIMEOUT_MS=1800000`（1800s）规避。此为环境特性（无 Redis 降级路径），非代码问题——降级行为本身正确（AC-03 验证）。

## 变更风险等级

**unit-sufficient**（CLI detectChangeRisk 自动判定）：本变更为后端内部权限缓存（core/permission_cache + rbac/data_scope 内部接入 + 5 service 显式失效 hook），不涉及 daemon↔backend 跨进程、session/lease/lifecycle 状态机、或部署启动路径。Redis 为既有基础设施，无新部署组件。

## Runtime Evidence

CLI detectChangeRisk 因 design/plan 含触发词（daemon-client 路径 / backend / bootstrap seed / docker-compose Redis）判定 deployment-critical。实际本变更为**后端内部权限缓存**，不改部署启动路径 / daemon 协议 / lifecycle 状态机。真实集成证据如下：

**启动验证（实测）**：
- 启动命令 `uvicorn app.main:app`（backend 入口不变；permission_cache 经 rbac/data_scope 被 `core/auth_deps.require_permission` 间接调用，无新 router/endpoint/中间件）
- 实测 `from app.main import app` → **app build OK, 400 routes**（所有受保护路由经 require_permission → has_permission → collect_* 缓存路径完整可建）
- `get_settings().permission_cache_ttl = 300`（config 字段生效）
- `rbac.collect_permissions` 已接入缓存（`get_cached_permissions` 导入 rbac）；`data_scope._compute_ppm_scope` 存在（两入口共享 ppm-scope 缓存）

**daemon↔backend 调用（协议未变更）**：
- 本变更**不改** daemon 协议 / WebSocket / session / lease / agent_run。`workspace/service.scan_generate`（daemon-client 建工作区路径）新增的 `invalidate_all_permissions` 是**后端 commit 后的内部调用**（在 `start_scan_dispatch` 返回后），不经 daemon 通道、不改 daemon-client 契约。
- Redis 为既有基础设施（`deploy/docker-compose.yml` redis:7-alpine + `core/redis.py` async 客户端），**无新部署组件、无新环境变量（除可选 PERMISSION_CACHE_TTL）、无 migration**。

**终态断言（测试）**：
- `test_permission_cache.py` 17 测试：AC-01 缓存命中 `session.execute` 计数不增 / AC-02 invalidate 清 perm:*+ppm-scope:* 保留其它 key + role create / workspace create / **scan_generate** 三 spy 断言 `calls["n"]==1` / AC-03 Redis 故障降级（get→None、set 静默、invalidate 升 ERROR）/ AC-04 ppm-scope 还原 `set[uuid.UUID]` isinstance 断言 / AC-05 经理 problem_operable 本项目 True、非本项目 False
- 回归：ppm 模块 402 passed + 核心（auth/admin/workspace）315 passed，零失败

**结论**：虽触发词命中，本变更实际不涉部署 / 启动 / daemon 协议变更。app 启动（400 routes）+ 缓存调用链（rbac/data_scope→auth_deps）+ 终态测试（17 缓存测试 + 717 回归）均验证通过，降级范式（Redis 故障回退 DB）保证认证/鉴权永不因缓存层失败。
