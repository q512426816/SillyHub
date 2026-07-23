---
author: qinyi
created_at: 2026-07-20 14:58:00
---

# 需求（Requirements）— PPM 菜单权限 key 独立化

## 功能需求

### FR-01 新增 9 个 PPM 菜单权限枚举
- **Given** backend `Permission` 枚举当前有 8 个 PPM 成员（ccfab86a 后）
- **When** 新增 9 个成员（PPM_WORKBENCH_VIEW/PPM_PROJECT_MEMBER_READ/PPM_PROJECT_STAKEHOLDER_READ/PPM_PROJECT_PLAN_READ/PPM_PLAN_NODE_READ/PPM_MILESTONE_DETAIL_READ/PPM_PROBLEM_LIST_READ/PPM_PROBLEM_CHANGE_READ/PPM_TASK_PLAN_READ）
- **Then** 枚举共 17 个 PPM 成员（14 菜单 key + 3 悬空旧 key，总枚举 62），`group` property 全部归 PermissionGroup.PPM

### FR-02 14 菜单各配专属 key
- **Given** menu-permissions.ts 14 个 PPM 菜单共享 8 key
- **When** 按 design §5 映射表重映射
- **Then** 每个菜单的 permissions 数组含且仅含其专属 key，无 2 菜单共享同一 key

### FR-03 seed 迁移清单 8→14
- **Given** 202607041000_seed_ppm_permissions 的 PPM_PERMISSIONS 清单 8 项
- **When** 加 9 个新 key
- **Then** 新环境 seed 14 个 PPM key 给 platform_admin

### FR-04 platform_admin 自动获新 key
- **Given** seed_platform_admin_role 启动遍历枚举
- **When** backend 重启
- **Then** platform_admin 拥有全部 14 个 PPM key（含 9 新增），幂等补种不重复

### FR-05 悬空旧 key 保留
- **Given** plan:read/problem:read/task:read 不再被菜单直接引用
- **When** 重映射后
- **Then** 这 3 个旧 key 仍在枚举（不删），仍归 PPM 组，已授权角色不受影响

### FR-06 测试同步
- **Given** test_ppm_permissions EXPECTED=8、test_permissions count=53、menu-permissions.test.ts mirror=54
- **When** 扩容后
- **Then** EXPECTED=17、count=62、mirror=63（PPM 17），各菜单断言为专属 key

### FR-07 openapi 重生成
- **Given** openapi.json ppm 权限枚举 8 值
- **When** dump_openapi 重生成
- **Then** 枚举含 14 值

### FR-08 admin picker 展示新 key
- **Given** picker 按枚举渲染
- **When** 枚举 +9
- **Then** picker 列出 14 个 PPM 菜单 key + 3 悬空旧 key（共 17 PPM 条目）

## 非功能需求

- **NFR-01** 命名参照原系统（RuoYi）细分权限语义，贴合菜单名，可读性好。
- **NFR-02** 兼容 Windows/Linux/macOS（纯枚举+数据，无平台依赖）。
- **NFR-03** 不破坏现有 role_permissions 数据（旧 key 不删）。
