---
author: flow-machine-draft
created_at: 2026-10-09T18:35:00.000Z
---
# 设计记录（Design Record）— 2026-10-09-daemon-ci-types-gate

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

daemon-ci.yml 两个小改：(1) 触发 paths 增补 `backend/openapi.json`——漂移源头是后端契约变更，原触发只看 sillyhub-daemon/** 时后端独改根本不跑 daemon-ci，守门形同虚设；(2) Install 后、Typecheck 前新增「api-types drift check」步骤跑既有 `pnpm gen:types:check`（scripts/gen-api-types.mjs 重生成 + git diff --exit-code src/api-types.ts）——零新脚本，复用仓库已有守门命令。配套提交重生成后的 api-types.ts：动手时守门当场抓到真实漂移（并行会话 dump 端点改了 openapi.json 未重生成 daemon 类型，+113 行），一并追赶。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `.github/workflows/daemon-ci.yml`：触发 paths 增补 backend/openapi.json（push/pull_request 双处）；步骤序列新增 api-types drift check（Install 与 Typecheck 之间）。
- `sillyhub-daemon/src/api-types.ts`：重生成（+113 行，dump 端点契约追赶），类型面零运行时影响（tsc 0 error 实证）。
- 代码 / 端点 / 协议：零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：CI 步骤顺序固定（Install → drift → Typecheck → Test），drift 在 typecheck 前拦截生成物债。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：CI runner 各自独立 checkout；drift check 只读 openapi.json、只写生成物副本（diff 后即弃，不 push）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：CI 失败即红不落库；本地 gen:types:check 失败只留工作区 diff（幂等，重生成即恢复）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：gen 脚本锚定同仓 backend/openapi.json 相对路径；CI 路径过滤只影响本仓库 workflow 触发。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：drift check 在 CI 上重生成时 openapi-typescript 版本与本地不一致会导致输出形态差误红——已由 frozen-lockfile（Install --frozen-lockfile）钉住同版本消解；本地实测同命令绿态通过。次风险：路径增补后 backend 独改也会触发 daemon-ci 全量测试，CI 时长略增（分钟级，可接受）。试过放弃：(a) 单独开一个轻量 drift workflow——放弃，daemon-ci 已有 Node/pnpm 环境，复用零成本；(b) 在 frontend-ci 里顺带守 daemon 类型——放弃，职责域错位（daemon 生成物归 daemon-ci）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | .github/workflows/daemon-ci.yml | 触发 paths + drift check 步骤 |
| 修改 | sillyhub-daemon/src/api-types.ts | dump 端点契约追赶重生成 |
