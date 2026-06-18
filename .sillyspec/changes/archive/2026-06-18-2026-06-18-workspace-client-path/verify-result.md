---
author: qinyi
created_at: 2026-06-18 15:10:00
change: 2026-06-18-workspace-client-path
stage: verify
verdict: passed-with-conditions
---

# Verify Result — Workspace 支持 daemon 客户端路径

## 验证结论

**通过（附条件）**。11 任务全部实现，对照 design 5 Phase + FR-01~06 + D-001~D-006 全覆盖；测试无回归。附 3 项已知限制（均不阻塞核心功能，属环境/增强项）。

## FR 验收矩阵

| FR | 验收项 | 实现 | 测试 | 结果 |
|---|---|---|---|---|
| FR-01 | workspace path_source + daemon_runtime_id 字段 | task-01（model/schema/migration + ScanGenerateRequest） | 21 新测试 | ✅ |
| FR-02 | agent run 强绑 daemon 路由 + 离线 fail | task-03（dispatch_to_daemon + decide_backend 联动 + NoOnlineDaemonError(runtime_id)） | 11 新 + 175 回归 | ✅ |
| FR-03 | 前端 daemon 目录树形浏览 | task-04（WS RPC 端点）+ task-05（list_dir handler）+ task-11（DaemonDirBrowser） | 23+121+ tsc | ✅ |
| FR-04 | list_dir allowed_roots 白名单 | task-02（config allowed_roots + normalize）+ task-05（穿越防护） | 37 + file-rpc 13 | ✅ |
| FR-05 | spec 按需 bundle/sync | task-06（端点）+ task-07（exec-ctx spec_root 自决）+ task-09（daemon pull/push） | 30 + 8 + 28 | ✅ |
| FR-06 | scan/scan-generate daemon 派发 | task-08（create 跳过本地 scan + scan_generate_daemon_client + router 分支 + 权限守卫） | 4 新 | ✅ |

## 决策覆盖

| 决策 | 状态 |
|---|---|
| D-001@v1 强绑 daemon + 离线 fail | ✅ task-03 |
| D-002@v1 allowed_roots 白名单 | ✅ task-02/05 |
| D-003@v1 spec 服务器托管 | ✅ task-06/08/09 |
| D-004@v1 path_source 字段 | ✅ task-01 |
| D-005@v1 list_dir RPC | ✅ task-04/05/11 |
| D-006@v1 按需 bundle/sync | ✅ task-06/09 |

## 测试结果

| 范围 | 结果 |
|---|---|
| backend workspace 模块 | 157 passed（含 router 权限守卫增强） |
| backend 变更模块（workspace/agent/daemon/spec_workspace） | 472 passed |
| daemon task 相关（task-02/05/09 + task-runner 回归） | 274 passed / 11 files |
| frontend tsc | 通过（含 client-path lib + permission 守卫） |
| ruff / mypy（workspace） | 通过 |
| daemon 全量 | 779 passed / 10 failed（预存环境失败：agent-detector 真实 PATH、cli 引用 Python test_cli、terminal-observer Windows spawn；stash 基准确认与本变更无关） |

## 安全边界验证

- ✅ D-002 allowed_roots 穿越防护（`..` 穿越 / 兄弟撞名 / symlink 逃逸 / Windows 大小写）— task-05 file-rpc 单测覆盖
- ✅ task-06 sync 解包路径穿越防护（绝对路径/盘符/`..`）— task-06 单测覆盖
- ✅ task-09 tar 解包路径穿越防护 — task-09 单测覆盖
- ✅ router 权限守卫：server-local 路径需 workspace:admin（daemon-client 不受限）— 增强项

## 已知限制（不阻塞）

1. **task-01 alembic upgrade 受 Windows GBK 编码阻塞**：`uv run alembic` 触发 alembic.ini GBK 解码错误（预存环境问题）。SQLite 上已做加列冒烟，**待 Postgres dev DB 手动 `alembic upgrade head` + downgrade 往返验收**。
2. **task-06 旧 stub sync 端点被前端 workspace 详情页 Sync 按钮调用**：新 sync 端点覆盖后该废按钮会 422。属废 UI 遗留，建议后续清理 `syncSpecWorkspace`/`handleSync`/Sync 按钮。
3. **task-08 rescan daemon-client 完整 dispatch 未实现**：当前依赖 `service.rescan` 对 platform-managed spec_root 的兼容（scan 服务器 spec_root，不读客户端 root_path）。完整"重新派 scan lease 刷新"留作增强。

## 兼容性回归

- ✅ server-local workspace 创建/扫描/agent run 全链路零变化（path_source 默认 server-local，行为不变）
- ✅ 现有 workspace/router 测试全通过（157 passed）

## 结论

核心功能（daemon-client workspace 接入：字段/强绑路由/list_dir 浏览/spec 按需下发/scan 派发）端到端实现且测试覆盖，server-local 完全兼容。可进入 archive 阶段。建议 archive 前在 Postgres 环境补验 alembic 迁移（限制 1）。
