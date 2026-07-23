---
author: qinyi
created_at: 2026-07-20 12:32:27
---

# 任务清单（Tasks）— 精简 PPM 权限

> 本文件为 brainstorm 阶段骨架，详细 Wave / Task 卡片 + 依赖关系 + 验收由 `sillyspec run plan` 阶段展开生成。

## 概览

- 变更：2026-07-20-ppm-permission-simplify
- 规模：large（约 13 文件 + 数据库迁移 + 跨 backend / frontend / sillyhub-daemon 三子项目）
- 预计 Wave：5（对应 design.md 的 5 个 Phase）
- 预计 Task 数：8-10

## Wave / Phase 骨架（待 plan 细化）

- [ ] **Wave 1 / Phase 1** — 删 17 个 PPM_* 操作权限枚举成员、留 8 个菜单权限（FR-01, FR-02）
- [ ] **Wave 2 / Phase 2** — 6 个 ppm router 去权限校验，改用 get_current_principal（FR-03, D-002）
- [ ] **Wave 3 / Phase 3** — 数据库迁移双轨：改旧 seed 清单 25→8 + 新增清理迁移 DELETE 17 条（FR-04, D-003）
- [ ] **Wave 4 / Phase 4** — 权限枚举测试更新 EXPECTED 25→8（FR-05）+ 新增 ppm 接口冒烟测试（FR-08, R-04）
- [ ] **Wave 5 / Phase 5** — 前端 project-members 菜单清悬空 write（FR-06, D-001）+ admin picker 确认（FR-07）+ daemon api-types 重生成（FR-07）

## 验收（对应 design.md AC-1 ~ AC-8）

- AC-1 枚举 25→8 + test_ppm_permissions 通过
- AC-2 6 router 无 require_permission_any
- AC-3 role_permissions 17 条清零
- AC-4 登录 200 / 未登录 401
- AC-5 project-members 菜单可见
- AC-6 picker 不列被删权限
- AC-7 backend lint + frontend typecheck 通过
- AC-8 权限测试 + 冒烟测试全绿

（详细任务卡 / 依赖 / 验收脚本由 `sillyspec run plan --change 2026-07-20-ppm-permission-simplify` 生成）
