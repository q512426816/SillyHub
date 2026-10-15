---
author: flow-machine-draft
created_at: 2026-10-15T00:05:10.236Z
---
# 需求规格（Requirements）— 2026-10-15-fix-ci-red

## 功能需求

### FR-01: sillyhub-daemon/src/api-types.ts 与 backend/openapi.json 重新生成对齐，pnpm gen:types:check 本地通过

- sillyhub-daemon/src/api-types.ts 必须由当前 backend/openapi.json 经 `pnpm gen:types` 生成（幂等，两遍生成零差异），提交后 `pnpm gen:types:check` 必须零退出码。

#### 场景：主路径

- Given backend/openapi.json 含 system_status/files-refresh/deploy-records 接口演进且 daemon 类型文件落后
- When 在 sillyhub-daemon 执行 pnpm gen:types 并提交
- Then gen:types:check（git diff --exit-code）零退出码，daemon typecheck 零错

### FR-02: menu-permissions.test.ts 与 permission.test.ts 数量锚按源码现值更新（组长度/system 区条数/权限镜像长度/FR-02 清单），仅这两个测试文件全绿

- 前端菜单测试的数量锚必须与 menu-permissions.ts 源码常量现值一致（组 38 / system 6 / 镜像 60 / 清单含 server-status），禁止保留任何落后于源码的硬编码数字。

#### 场景：主路径

- Given admin-server-status 已使 MENU_PERMISSION_GROUPS 增至 38 条、system 区 6 条、后端权限枚举 60（含 system_status:read）
- When 仅运行 menu-permissions.test.ts 与 permission.test.ts
- Then 62 用例全部通过，tsc/eslint 对这两个文件零错

### FR-03: 提交推送后 main 上 daemon-ci 与 frontend-ci 变绿

- 本次灭火提交推送后，main 上 daemon-ci 与 frontend-ci 两个工作流必须以 success 收尾。

#### 场景：主路径

- Given main 存量红灯仅由 FR-01/FR-02 两类漂移构成（已核最近失败日志）
- When 推送本变更提交
- Then GitHub Actions 上 daemon-ci 与 frontend-ci 结论为 success

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon「pnpm gen:types:check + pnpm typecheck」（无独立用例文件，以命令零退出码为准）
FR-02: frontend/src/lib/__tests__/menu-permissions.test.ts「MENU_PERMISSION_GROUPS 数据完整性」全组 + frontend/src/lib/__tests__/permission.test.ts「FR-06 #3: platform admin sees all 6 entries in 'system' section」
FR-03: 不适用：验收面是 GitHub Actions 运行结论，无本地测试用例
