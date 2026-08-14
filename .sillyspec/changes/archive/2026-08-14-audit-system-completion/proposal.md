---
author: qinyi
created_at: 2026-08-14 14:05:38
---

# 提案（Proposal）

## 动机

`docs/architecture-4a.md` §8 漂移点 #1/#2/#3 + §1.3 审计双轨缺口：

1. `core/audit_hooks.py` 的 `register_audit_hooks` 设计完整但 production `main.py` 从未挂载，自动审计运行态休眠，实际靠约 19 处 service 手工 AuditLog；
2. 登录成功/失败仅 `log.info` 结构化日志，不入 `audit_logs` 表，无法追溯暴力破解；
3. `settings`/`PlatformSetting` 变更无任何审计（PK 非 UUID，挂 hooks 也被跳过）。

审计是企业级 4A「可审计」的硬要求（合规底线），本变更把审计体系补全到设计意图状态。

## 方案概要（方案 B · 常量集中）

- `main.py` lifespan 挂载 `register_audit_hooks`（幂等，一行）；
- `workflow/model.py` AuditLog 旁定义审计 action 常量 + `AUDIT_PLACEHOLDER_ID` 全零占位（D-002/D-004 共用单一定义）；
- `auth/service.py` login 三分支手工 AuditLog（成功=真实 user.id；失败/禁登=占位 + reason，raise 前显式 commit）；
- settings 写路径（`router.py` upsert 两处）手工 AuditLog（per-key 粒度，key + from/to 存 details）；
- 三组新增测试 + 全量 backend 回归。

设计详见 `design.md`；决策见 `decisions.md`（D-001~D-005）。

## 不在范围内（Non-Goals）

- 审计表清理/归档/轮转策略（审计增长治理另立变更）；
- daemon 侧写操作审计（无 audit_context 天然豁免，补齐需 actor 模型设计另议）;
- `AuditLog` schema 变更（resource_id 保持非空 UUID，占位绕行）；
- 扩大 `_EXCLUDED_TABLES`（D-001 观察机制后再议）。
