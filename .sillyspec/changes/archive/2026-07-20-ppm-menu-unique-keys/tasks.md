---
author: qinyi
created_at: 2026-07-20 14:58:00
---

# 任务清单（Tasks）— PPM 菜单权限 key 独立化

> 详细 Wave / Task 卡片由 `sillyspec run plan` 阶段生成。

## 概览

- 变更：2026-07-20-ppm-menu-unique-keys
- 规模：medium（约 7 文件：backend 枚举+迁移+2 测试 / frontend 菜单映射+测试 / openapi）
- 预计 Wave：4（对应 design 4 Phase）
- 预计 Task 数：5-6

## Wave 骨架（待 plan 细化）

- [ ] **Wave 1 / Phase 1** — backend 枚举 +9 个 PPM 菜单 key（FR-01）
- [ ] **Wave 2 / Phase 2** — seed 迁移清单 8→14（FR-03）+ platform_admin 补种验证（FR-04）
- [ ] **Wave 3 / Phase 3** — frontend menu-permissions.ts 14 菜单 key 重映射（FR-02）
- [ ] **Wave 4 / Phase 4** — 测试同步（FR-06）+ openapi 重生成（FR-07）

## 验收（对应 design AC-1 ~ AC-8）

- AC-1 枚举 17 个 PPM 成员（14 菜单 + 3 悬空）+ test_ppm_permissions 通过
- AC-2 test_permissions count 62 通过
- AC-3 14 菜单各专属 key 无共享
- AC-4 menu-permissions.test.ts mirror=63（PPM 17）全绿
- AC-5 platform_admin 拥有 17 个 PPM key
- AC-6 backend lint + frontend typecheck 通过
- AC-7 openapi ppm 枚举 14 值
- AC-8 picker 列 17 PPM 条目（14 菜单 + 3 悬空）
