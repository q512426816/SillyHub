---
author: qinyi
created_at: 2026-07-23 16:40:00
change: 2026-07-23-backend-permission-perf
plan_level: light
---

# 轻量计划（Light Plan）：权限缓存熔断降级

## 来源

brainstorm 阶段需求澄清 + design.md + decisions.md(D-001~003@v1)。用户确认 design。

## 范围

- 修改 `backend/app/core/config.py`：新增 2 个熔断器配置项
- 修改 `backend/app/core/permission_cache.py`：新增熔断状态机 + 4 个读写函数入口插入熔断检查
- 修改 `backend/tests/modules/test_permission_cache.py`：新增熔断器单元测试

## Tasks

- [ ] task-01: config.py 新增熔断器配置项（覆盖：D-003@v1）
- [ ] task-02: permission_cache.py 熔断器状态机 + 4 个读写函数入口插入熔断检查（覆盖：FR-01, FR-02, D-001@v1）
- [ ] task-03: test_permission_cache.py 新增熔断器单元测试（覆盖：FR-03, FR-04）

## 验收

- 熔断器单元测试通过（测试不依赖外部 Redis）
- 单进程 pytest 全量通过（无回归）
- ruff check + ruff format --check 通过
- 测试环境无 Redis 时 permission_cache 调用快速降级，不出现 3s+ 等待

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02 | FR-01, FR-02 测试通过 |
| D-002@v1 | task-02 | invalidate_all_permissions 不走熔断（测试断言） |
| D-003@v1 | task-01 | 配置项 presence + threshold=0 禁用熔断（测试断言） |
