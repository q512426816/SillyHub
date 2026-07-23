# verify-result — 2026-07-20-ppm-menu-unique-keys

日期：2026-07-20 15:49
结论：**PASS WITH NOTES**（单测全绿；真实部署 e2e 菜单显隐留待部署验证）

## 验收对照（AC-1 ~ AC-8）

| AC | 内容 | 结果 |
|---|---|---|
| AC-1 | 14 个 ppm 菜单各有独立 key，无共享 | ✅ menu-permissions.ts 14 菜单 permissions 各单元素、key 互不相同 |
| AC-2 | 5 个保留 key 不变（project/customer/work-hour:read、work-hour:stat、kanban:view） | ✅ 未改 |
| AC-3 | 9 个新菜单专属 key 加入 Permission 枚举 | ✅ permissions.py PPM 8→17 |
| AC-4 | 3 个悬空旧 key（plan/problem/task:read）保留不删（D-002） | ✅ 仍在枚举 + PPM 组 |
| AC-5 | seed PPM_PERMISSIONS 8→17 | ✅ 迁移清单同步 |
| AC-6 | platform_admin 启动兜底补种 17 个 PPM key | ✅ test_platform_admin_seed_grants_all_ppm_permissions 通过（seed 遍历枚举自动补） |
| AC-7 | openapi.json ppm 枚举含 17 值 | ✅ dump_openapi 重生成，新 key 命中 |
| AC-8 | picker 数据源确认 + 悬空 key 显示结论 | ✅ picker 按 menu-permissions.ts 菜单卡渲染（非按枚举），悬空 3 旧 key 不被菜单引用故**不显示**（正确） |

## 测试

- backend `tests/modules/auth/`：**98 passed + 2 xfailed（预存）**，零回归
  - test_ppm_permissions.py：57 passed（17 成员存在 / count=17 / platform_admin 全授予 / 前缀 / 无重复 / 归 PPM 组 / 非系统角色无 PPM）
  - test_permissions.py：count=62 通过
- frontend `menu-permissions.test.ts`：**35 passed**（mirror=63、各菜单专属 key 断言、14 菜单 section=ppm/absolute）
- frontend `pnpm typecheck`：通过

## 枚举/镜像计数

- Permission 枚举总数：53 → **62**（+9 菜单专属）
- 其中 PPM 组：8 → **17**（14 菜单 key + 3 悬空旧 key）
- 前端 BACKEND_PERMISSION_KEYS 镜像：54 → **63**

## 遗留（NOTES）

- R-01：真实部署环境菜单显隐 e2e（登录非 platform_admin 角色逐菜单勾选验证）留待部署后人工验证。
- R-03：openapi.json 已按每提交约定重生成；frontend api-types.ts 未重生成（菜单 key 不影响 API 类型，无需）。
- worktree baseline 漂移 → 用 cp workaround apply 主仓库（7 文件，与主仓库并发改动零重叠）。
