# module-impact — 2026-07-20-ppm-menu-unique-keys

## 改动文件（7）

| 文件 | 改动 |
|---|---|
| backend/app/modules/auth/permissions.py | Permission 枚举 +9 菜单专属 PPM 成员（8→17） |
| backend/migrations/versions/202607041000_seed_ppm_permissions.py | PPM_PERMISSIONS 清单 8→17 |
| backend/openapi.json | 重生成（ppm 权限枚举 17 值） |
| backend/tests/modules/auth/test_ppm_permissions.py | EXPECTED 8→17 + count 断言 8→17 |
| backend/tests/modules/auth/test_permissions.py | count 53→62 |
| frontend/src/lib/menu-permissions.ts | 14 菜单重映射到独立 key（9 改 5 保留） |
| frontend/src/lib/__tests__/menu-permissions.test.ts | mirror 54→63 + 菜单专属 key 断言 |

## 影响模块

- **auth（权限枚举/种子）**：新增 9 个 PPM 菜单专属权限成员；platform_admin 启动兜底自动补种（遍历枚举）。
- **ppm 前端菜单显隐**：14 个菜单从共享 8 key 改为各独立 key，admin 可在角色管理中逐菜单独立控制显隐。
- **admin 角色权限 picker**：菜单卡随 menu-permissions.ts 自动展示 14 个独立 key。

## 不影响

- 后端 router 鉴权逻辑（上一变更已去接口校验，纯前端菜单显隐粒度化）。
- 其它模块权限（workspace/admin/agent/change 等）。
