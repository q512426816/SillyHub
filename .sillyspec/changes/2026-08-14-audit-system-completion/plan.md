---
author: qinyi
created_at: 2026-08-14 14:20:00
plan_level: light
---

# 实现计划（Plan）

## 概述

按 design.md §4（方案 B · 常量集中）拆 5 个 task / 3 个 Wave：W1 基础（常量 + 挂载）→ W2 业务审计（登录 + settings，依赖 W1 常量）→ W3 验证（hooks 生效用例 + 全量回归）。总改动 7 文件（4 源 + 3 测试），无 schema/状态机/调度变更。

## Wave 结构

| Wave | 任务 | 并行性 | 依赖 |
|---|---|---|---|
| W1 基础 | task-01 审计常量 / task-02 挂载 hooks | 不同文件可并行 | 无 |
| W2 业务审计 | task-03 登录审计 / task-04 settings 审计 | 不同文件可并行 | task-01（常量） |
| W3 验证收尾 | task-05 生效用例 + 全量回归 | 单任务 | W1 + W2 全部 |

## Tasks

- [x] task-01: workflow/model.py 定义 5 个审计 action 常量 + AUDIT_PLACEHOLDER_ID
- [x] task-02: main.py lifespan 挂载 register_audit_hooks
- [x] task-03: auth login 三分支手工审计 + 测试
- [x] task-04: settings upsert per-key 手工审计 + 测试
- [x] task-05: audit_hooks 生效用例 + 全量回归

## 任务总表

| 任务 | 优先级 | 文件 | 依赖 | 完成标准 |
|---|---|---|---|---|
| task-01: workflow/model.py 定义 5 个审计 action 常量 + AUDIT_PLACEHOLDER_ID | P0 | `backend/app/modules/workflow/model.py` | — | AUTH_LOGIN_SUCCESS/AUTH_LOGIN_FAILED/PLATFORM_SETTING_CREATE/PLATFORM_SETTING_UPDATE + 全零占位 UUID 可 import；不含 _DELETE（Grill C-6）；ruff+mypy 过 |
| task-02: main.py lifespan 挂载 register_audit_hooks | P0 | `backend/app/main.py` | — | lifespan 内 engine 就绪后调用；启动日志出现 "Audit hooks registered"；重复 create_app 幂等（event.contains 跳过） |
| task-03: auth login 三分支手工审计 + 测试 | P0 | `backend/app/modules/auth/service.py` + `backend/tests/modules/auth/`（登录审计用例） | task-01 | 成功=真实 user.id（FR-03）；失败/禁登=占位 + reason + raise 前显式 commit、写审计失败仅 log.error 不阻断（FR-04，actor_id 取 None）；三路径测试过 |
| task-04: settings upsert per-key 手工审计 + 测试 | P1 | `backend/app/modules/settings/router.py`（PUT 循环 :80-108 + `_write_setting_json` :168-189 两处）+ `backend/tests/modules/settings/` | task-01 | 每个 key 变更一条 AuditLog（action=PLATFORM_SETTING_CREATE/_UPDATE，resource_id 占位，details 含 key/from/to）（FR-05）；测试过 |
| task-05: audit_hooks 生效用例 + 全量回归 | P0 | `backend/tests/`（hooks 生效用例） | task-02, task-03, task-04 | ①有 audit_context 的 insert/update/delete 各产生一条 AuditLog ②无 ctx 不产生 ③audit_logs 自身写不递归（FR-06）；全量 backend pytest 通过，受影响断言加 action/resource_type 过滤修正、禁删断言（FR-07） |

## D-xxx@vN / FR-xxx 覆盖矩阵

| 决策 | FR | 覆盖 task |
|---|---|---|
| D-001@v1（排除表最小改动+观察） | FR-01 | task-02（不动 `_EXCLUDED_TABLES`） |
| D-002@v1（登录失败全零占位） | FR-02 / FR-04 | task-01 / task-03 |
| D-003@v1（手工/hooks 双轨并存） | design §3 非目标 | 全部 task 约束：不删既有手工插入 |
| D-004@v1（settings 手工插入） | FR-02 / FR-05 | task-01 / task-04 |
| D-005@v1（方案 B 常量集中） | FR-02 | task-01（service 代码禁内联 action 字面量） |

FR-06 / FR-07 → task-05。

## 风险与应对（承接 design §7）

- R-01（hooks 全局生效影响现存断言）：task-05 全量回归，加过滤修正；
- R-02（sessions 轮换审计行增长）：D-001 观察机制，不在本计划内扩排除；
- R-03（失败分支 commit 竞争）：task-03 用 try/except 包裹 + 测试实证审计确实落库；
- R-04（双轨冗余）：接受（D-003）。

## 测试策略

local.yaml `test_strategy: module`：task-03/task-04 分别跑 auth / settings 模块测试；task-05 跑 hooks 用例 + backend 全量（`cd backend && uv run pytest -q --no-cov`）。
