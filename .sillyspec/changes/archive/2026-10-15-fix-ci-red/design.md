---
author: flow-machine-draft
created_at: 2026-10-15T00:05:10.236Z
---
# 设计记录（Design Record）— 2026-10-15-fix-ci-red

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

main 两处存量红灯均为「生成物/断言锚未跟进源码演进」，无行为变更：① 在 sillyhub-daemon 跑 `pnpm gen:types` 从 backend/openapi.json 重新生成 src/api-types.ts（补齐 2026-10-14-admin-server-status、files-refresh-explicit-sync、deploy-records 三轮接口演进，+181/-7 行）；② 前端 menu-permissions.test.ts 与 permission.test.ts 的数量锚按源码现值更新（组长度 37→38、system 区 5→6、BACKEND_PERMISSION_KEYS 镜像 59→60 并补 system_status:read、FR-02 menuKey 清单加 server-status、platform admin system 区 5→6 条）。选直接对齐而非改断言风格，因为本变更定位是灭火，断言风格改造（硬编码数字改推导）属治本另行立项。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外签名或行为变化。改动面仅：生成文件 sillyhub-daemon/src/api-types.ts（内容与 backend/openapi.json 重新对齐）+ 两个纯测试文件的断言常量。不适用：未动任何函数/端点/命令/文件格式。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：不适用——生成物是 openapi.json 的纯函数式产物，已验证两遍生成 diff 一致（幂等），不存在乱序输入。
2. 并发写：api-types.ts 是单执行体生成物；若他人同时改 backend/openapi.json 并重新生成，以提交先后为准，CI 的 gen:types:check 会兜底拦住新的漂移。
3. 切换/生命周期：不适用——无运行态，静态文件对齐。
4. 作用域：不适用——仅本仓库 main 一份生成物，无跨工作区/多实例副本。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：CI 的 daemon 测试/构建消费新类型暴露未知类型错——已本地跑 `pnpm -C sillyhub-daemon typecheck` 零错兜住。试过但放弃：无（未尝试其它方案，直接对齐是既定成功标准）。
