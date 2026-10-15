---
author: flow-machine-draft
created_at: 2026-10-15T00:05:10.236Z
---
# 任务注册表（Tasks）— 2026-10-15-fix-ci-red

- [x] task-01: sillyhub-daemon/src/api-types.ts 与 backend/openapi.json 重新生成对齐，pnpm gen:types:check 本地通过
- [x] task-02: menu-permissions.test.ts 与 permission.test.ts 数量锚按源码现值更新（组长度/system 区条数/权限镜像长度/FR-02 清单），仅这两个测试文件全绿
- [x] task-03: 提交推送后 main 上 daemon-ci 与 frontend-ci 变绿
- [x] task-04: event-wire.test.ts stripTimestamp 抹平助手补 F2 顶层 timestamp 字段（跨毫秒抖动致 daemon-ci 偶发红）
