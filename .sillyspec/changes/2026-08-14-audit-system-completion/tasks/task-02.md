---
author: qinyi
created_at: 2026-08-14 14:40:00
title: main.py lifespan 挂载 register_audit_hooks
priority: P0
wave: 1
depends_on: []
allowed_paths:
  - backend/app/main.py
---

# task-02: main.py lifespan 挂载 register_audit_hooks

## 目标

production 挂载自动审计钩子（漂移点 #1 修复）：`backend/app/main.py` lifespan 内调用 `register_audit_hooks(engine)`，使有 audit_context 的 ORM 写自动落 `audit_logs`。

## 实现要点

1. import：`from app.core.audit_hooks import register_audit_hooks`（放在 app 内层 import 区）。
2. 调用点：lifespan（`main.py:78` 起）内、**模型 import 完成之后**（audit_hooks 的 `register_audit_hooks` 会遍历 BaseModel 子类，须保证 mappers 已配置；放在 lifespan 现有 bootstrap（RBAC seed 等）附近即可，lifespan 时点所有 router 已 import）。
3. engine 参数取 lifespan 内可得的异步引擎（与 get_session_factory 同源）；若 lifespan 拿不到 engine 实例，用 `app.core.db` 暴露的引擎获取函数。
4. 幂等：`register_audit_hooks` 内部 `event.contains` 已防重复（audit_hooks.py:317），测试多次 `create_app` 安全，无需额外防重。
5. 不改 `_EXCLUDED_TABLES`（D-001 最小改动+观察）。

## 验收标准

| AC | 检查方式 | 通过条件 |
|---|---|---|
| AC-01 | 启动 backend（或测试 create_app + 触发 lifespan） | 日志出现 `Audit hooks registered for <N> tables` |
| AC-02 | 连续两次 create_app + lifespan | 第二次日志出现 `(skipped)` 标记，无重复注册 |
| AC-03 | ruff + mypy（backend） | 全过 |
