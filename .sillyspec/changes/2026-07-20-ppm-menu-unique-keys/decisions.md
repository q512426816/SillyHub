---
author: qinyi
created_at: 2026-07-20 14:58:00
---

# 决策（Decisions）— PPM 菜单权限 key 独立化

## D-001 方案 A：每菜单专属 key（命名贴合菜单名）✅ accepted

**决策**：14 个 PPM 菜单各配一个专属权限 key，命名参照原系统（RuoYi）细分权限语义（如 项目成员→`ppm:project-member:read`）。

**备选**：
- 方案 B：旧 key 复用给主菜单（新增仅 6，无悬空），但命名部分不贴合（task-plan 用 `task:read` 而非 `task-plan:read`）。
- 方案 C：方案 A + 删 3 个悬空旧 key（清理迁移），最干净但混入"删"方向、改动大。

**理由**：方案 A 命名直观贴合菜单名（admin 易理解），改动适中，悬空 key 无害保留。用户已确认推荐表。

## D-002 悬空旧 key 保留不删 ✅ accepted

**决策**：`ppm:plan:read` / `ppm:problem:read` / `ppm:task:read` 重映射后无菜单直接引用，但**保留在枚举不删**。

**理由**：
- 删除需额外清理迁移（DELETE role_permissions），混入"删"方向，扩大改动。
- 保留不破坏现有授权数据（规则 11 虽允许重置，但保留更安全）。
- 悬空 key 仍归 PPM 组，picker 会列但 admin 不勾即可，无害。
- 后续若嫌乱可单独 quick 补删（YAGNI 现在不做）。

## D-003 platform_admin 补种依赖启动 seed 兜底，不写补种迁移 ✅ accepted

**决策**：已部署环境 platform_admin 获得 9 个新 key，依赖 `seed_platform_admin_role`（service.py）启动时遍历枚举幂等补种，**不写 INSERT 补种迁移**。

**理由**：
- `seed_platform_admin_role` 已有逻辑（遍历 `Permission` 枚举 upsert），`test_platform_admin_seed_grants_all_ppm_permissions` 守护。
- 重启 backend 即补，项目未上线重启是常规操作。
- 写补种迁移 = 与 seed 兜底重复，违反 DRY。

**风险**：R-01（不重启则缺）→ 部署文档注明需重启。

## D-004 命名参照原系统细分权限语义 ✅ accepted

**决策**：新 key 命名参照原系统（RuoYi）的细分权限（`pm:project-member:read` → `ppm:project-member:read`、`ps:plan-node:read` → `ppm:plan-node:read` 等）。

**理由**：贴合业务语义，与迁移脚本 `migrate_from_ruoyi.py` 的源权限命名一致，可读性好，便于溯源。
