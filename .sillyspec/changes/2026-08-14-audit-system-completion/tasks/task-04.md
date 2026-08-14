---
author: qinyi
created_at: 2026-08-14 14:40:00
title: settings upsert per-key 手工审计 + 测试
priority: P1
wave: 2
depends_on: [task-01]
allowed_paths:
  - backend/app/modules/settings/router.py
  - backend/tests/modules/settings/
---

# task-04: settings upsert per-key 手工审计 + 测试

## 目标

漂移点 #3 修复：settings 变更入审计表。`platform_settings` PK 为 String 非 UUID，挂 hooks 也被跳过（Grill C-2），必须手工插入（D-004）。

## 实现要点（落点已核：`backend/app/modules/settings/router.py`，settings/service.py 只是 re-export shim——Grill C-7）

1. **两处写路径**：
   - PUT 循环（`router.py:80-108`）：per-key 粒度——**每个 key 的 upsert 产生一条 AuditLog**（requirements FR-05，可追溯单 key 变更）；
   - `_write_setting_json`（`router.py:168-189`）：同样 per-key。
2. 每条 AuditLog：
   - `action=PLATFORM_SETTING_CREATE`（原值不存在）或 `PLATFORM_SETTING_UPDATE`（原值存在）
   - `resource_type="platform_setting"`，`resource_id=AUDIT_PLACEHOLDER_ID`，`workspace_id=None`
   - `actor_id` = 路由认证主体 id（router 依赖已注入 user）
   - `details_json`：`{"key": <key>, "from": <旧值或 null>, "to": <新值>}`
3. 常量 import 自 workflow/model.py（D-005）。
4. **不设 delete 路径**（全仓无 delete 端点，Grill C-6）。

## 测试（`backend/tests/modules/settings/` 新增审计用例）

- PUT 新 key → 1 条 CREATE（details 含 key，from=null）
- PUT 已存在 key → 1 条 UPDATE（from/to 齐全）
- 批量 PUT 多 key → 每个 key 各一条（per-key 粒度实证）

## 验收标准

| AC | 检查方式 | 通过条件 |
|---|---|---|
| AC-01~03 | 上述测试 | 全过 |
| AC-04 | `uv run pytest tests/modules/settings -q --no-cov`（backend，若该目录测试命令在 local.yaml 未单列则跑 `app/modules/settings`） | 全过 |
| AC-05 | ruff + mypy | 全过 |
