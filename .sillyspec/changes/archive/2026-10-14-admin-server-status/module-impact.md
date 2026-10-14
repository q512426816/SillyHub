---
author: qinyi
created_at: 2026-10-15 00:26:40
---

# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| components-shared | `frontend/src/components/app-shell.tsx` | 调用关系变更（MENU_ICON_MAP 增 /admin/server-status→Server） | 否 |
| lib-api | `frontend/src/lib/api-types.ts` | 配置变更（gen:types 生成物再生成，Permission 联合类型扩员 system_status:read） | 否 |
| lib-health | `frontend/src/lib/health.ts` | 新增（getSystemStatus/SystemStatusResponse 恢复） | 否 |
| lib-menu-permissions | `frontend/src/lib/menu-permissions.ts` | 数据结构变更（system 组新增第 6 条 server-status） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/auth/permissions.py` 归属判定：backend 模块（auth 子域，模块索引 paths 未细分到 backend/app/**——索引粒度限制非游离）
- `backend/app/modules/health/router.py` 归属判定：backend 模块（health 子域，同上）
- `backend/tests/test_health.py` 归属判定：backend 模块测试面
- `backend/tests/modules/auth/test_permissions.py` 归属判定：backend 模块测试面（枚举计数锚 59→60）
- `backend/openapi.json` 归属判定：契约生成物（backend→frontend 桥）
- `frontend/src/app/(dashboard)/admin/server-status/page.tsx` 归属判定：app-pages 域新增管理页（索引过期未收录新路径）
- `frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` 归属判定：同上，页面测试
- `frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx` 归属判定：既有 admin 页测试锚更新（声明序/行数断言）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/components-shared.md` | AppShell 契约行补 MENU_ICON_MAP 增 /admin/server-status→Server | done |
| `modules/lib-api.md` | 注意事项补 2026-10-14-admin-server-status 再生成条目（Permission 扩员） | done |
| `modules/lib-health.md` | 卡面重写：getSystemStatus 恢复（定位/契约/关键逻辑/注意事项，废"已不存在"旧注） | done |
| `modules/lib-menu-permissions.md` | system 组条目 5 项→6 项（服务器信息 + 落位/锚定口径） | done |
| `_module-map.yaml` | 未匹配文件判定：backend/* 归 backend 模块域、admin 新页归 app-pages 域——均索引粒度限制（backend map 按 backend/** 粗粒度收录、frontend map 未含 admin 页面路径），非游离文件、非路径漂移，无需 rebuild | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
