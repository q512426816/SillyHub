---
author: flow-machine-draft
created_at: 2026-10-15T00:05:10.236Z
---
# 提案书（Proposal）— 2026-10-15-fix-ci-red

## 动机

任务原话转写：main 分支 CI 红灯灭火：daemon api-types 漂移 + 前端菜单测试数量锚过期，纯对齐修复无行为变更。
成功标准：
- sillyhub-daemon/src/api-types.ts 与 backend/openapi.json 重新生成对齐，pnpm gen:types:check 本地通过
- menu-permissions.test.ts 与 permission.test.ts 数量锚按源码现值更新（组长度/system 区条数/权限镜像长度/FR-02 清单），仅这两个测试文件全绿
- 提交推送后 main 上 daemon-ci 与 frontend-ci 变绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. sillyhub-daemon/src/api-types.ts 与 backend/openapi.json 重新生成对齐，pnpm gen:types:check 本地通过
2. menu-permissions.test.ts 与 permission.test.ts 数量锚按源码现值更新（组长度/system 区条数/权限镜像长度/FR-02 清单），仅这两个测试文件全绿
3. 提交推送后 main 上 daemon-ci 与 frontend-ci 变绿

## 成功标准（可验证）

1. sillyhub-daemon/src/api-types.ts 与 backend/openapi.json 重新生成对齐，pnpm gen:types:check 本地通过
2. menu-permissions.test.ts 与 permission.test.ts 数量锚按源码现值更新（组长度/system 区条数/权限镜像长度/FR-02 清单），仅这两个测试文件全绿
3. 提交推送后 main 上 daemon-ci 与 frontend-ci 变绿
