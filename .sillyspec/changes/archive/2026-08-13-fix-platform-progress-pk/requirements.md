---
author: qinyi
created_at: 2026-08-13 15:52:00
---

# 需求清单（Requirements）— platform_change_progress 主键缺陷修复

> change: `2026-08-13-fix-platform-progress-pk`
> 决策引用：D-001@v1 ~ D-005@v1（见 decisions.md）

## 功能需求

- **FR-01** 跨 workspace 同名变更进度可共存：`platform_change_progress` 允许 `(workspace_id=A, change_name=foo)` 与 `(workspace_id=B, change_name=foo)` 各占一行，互不覆盖；第二工作区上行不再 500。（D-001/D-002）
- **FR-02** `workspace_id=NULL` 历史行与带 workspace 的行共存：NULL 过渡行（shk_live_ 全局上行）不阻塞带 workspace 的新行；列表投影按复合键各命中各行。（D-001/D-003）
- **FR-03** 零 API 变更：progress 端点路径、`serializeForSync` 六表 body、`X-SillySpec-*` 头、409 冲突响应不变；旧客户端无感。（D-004）
- **FR-04** 现有数据保留：现有 progress 行（含 NULL 过渡行）migration 回填 `id` 保留，不丢进度镜像。（D-003）
- **FR-05** 同 workspace 并发双发冲突回退：upsert IntegrityError 回退逻辑（rollback→重查→UPDATE）在新主键下仍正确（撞复合唯一而非 change_name PK）。（D-005）

## 非功能需求

- **NFR-01** migration 跨库可执行：PG 生产 + SQLite 测试库（`batch_alter_table`，precedent `20260811104500_agent_profile_llm_provider.py`）。（D-001）
- **NFR-02** 测试覆盖：跨 workspace 重名各占一行 / NULL 行共存 / 同 workspace 并发回退 / 迁移后旧数据 id 回填。（D-001/D-005）
- **NFR-03** 不涉及生命周期契约：只调存储层表结构，不触碰 session/lease/agent_run/daemon 状态机。（design §7.5）

## 决策覆盖

D-001@v1~D-005@v1 全部被 FR-01~FR-05 覆盖，无未覆盖决策。
