---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-11
allowed_paths:
  - backend/tests/modules/daemon/test_service.py
  - backend/tests/modules/daemon/test_router.py
  - backend/tests/modules/daemon/test_migration_build_id.py
---

# task-11: 端到端 + 兼容回归

## 所属 Wave
Wave 4

## 文件
- 无新文件（手动/集成验证 + 后端 service/router/migration 测试收尾）

## 子任务
- backend service 测试：`backend/tests/modules/daemon/test_service.py`（register/heartbeat 写入 version/build_id；旧 daemon 不带字段不报错）
- backend router 测试：`backend/tests/modules/daemon/test_router.py`（GET /version 双字段；register 接收版本）
- migration 测试：新增 `backend/tests/modules/daemon/test_migration_build_id.py`（upgrade/downgrade）

## 验收标准
- [ ] backend test_service：register/heartbeat 写入断言通过
- [ ] backend test_router：GET /version + register 接收版本断言通过
- [ ] migration upgrade/downgrade 测试通过
- [ ] 三子项目全量测试绿（backend pytest + frontend pnpm test + daemon pnpm test）
- [ ] 手动端到端：daemon 注册→版本可见→点升级→daemon 重启→re-register 新版本刷新；旧 daemon 不报错

## 依赖
- Wave 1-3 全部完成

## 覆盖
- 全 FR, D-008@V1（兼容回归）

## 风险防范
- 改 backend router 必跑 test_router（memory: backend-router-change-run-router-tests）
- migration 测试用 SQLite in-memory（memory: backend 测试 SQLite vs PG）
- 端到端手动验证需部署环境（标记为遗留运行时验证，不阻塞 archive）
