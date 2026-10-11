---
author: flow-machine-draft
created_at: 2026-10-11T14:27:11.533Z
---
# 设计记录（Design Record）— 2026-10-11-ci-red-batch-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

5 处 CI 红灯全部属「生产契约变更漏同步钉子测试/生成物」一类技术债，生产代码零缺陷零改动：backend PublishIntent 测试夹具补上 21eb98d53 引入的必填位 `duration_api_ms=None`（production submit_commit.py 一直由关键字传入，仅手工构造的夹具漏更）；迁移链尾锚按测试自载的「随主线新迁移接续前移」惯例从 20261010190000 前移到 cc3c022b6 并入的 merge 迁移 c515ffd62859；frontend 两处钉子（menus 声明序 19/20/21、git-log TABS 16）按 8a928588f 组件页下线后的注册表现状重算为 17/18/19 与 15——正是 4746ac875 登记的「共享断言面」同款坑复现；daemon 漂移以 gen:types 重生成清偿（消费已提交 openapi.json，不碰后端）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无生产接口变化。全部改动限于测试文件（backend×2、frontend×2）与生成物（sillyhub-daemon/src/api-types.ts，机器重生成非手写）。PublishIntent 构造签名不变（夹具补参数对齐既有签名）；迁移 head 断言值前移不改变迁移链本身。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——本变更为测试锚与生成物同步，无运行时输入/事件序假设；drift check 以「重生成输出 == 提交内容」判定，与执行顺序无关（openapi-typescript 确定性输出）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   生成物重生成与并行会话冲突由 gen-api-types.mjs 自带的未提交改动守卫拦截（openapi.json/api-types.ts dirty 即中止）；本次两文件在重生成前均干净，无卷入他人 WIP 风险。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   flow done 中间态拒收（空槽/问题文本改写）属协议内断点续——已按要求填 FR 行为句/测试绑定/design 四节（问题原文钉死、答案写下方）后重跑同命令，已完成子步幂等跳过。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   sillyhub-daemon/src/api-types.ts 仅 daemon 侧消费；WorkspaceBrief→app__modules__workspace__schema__WorkspaceBrief 改名经 grep 证实 daemon/frontend 源码零直接引用（前端用 lib/workspace.ts 手写同名接口），不串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：daemon api-types.ts 的 872 行漂移里除已核实的改名外还可能藏其它 schema 形态变化，daemon 源码若引用了被改窄的类型会 typecheck 红灯——已用 `pnpm -C sillyhub-daemon typecheck`（0 错）实测兜住，残余风险由 daemon-ci 的 typecheck+test 复核。放弃的方案：给 PublishIntent.duration_api_ms 补默认值 `= None`（需移动字段位置避开 dataclass 非默认位序约束，会改变既有位置参数语义，波及 production 构造点，收益仅省一处夹具参数——不做）；让迁移锚测试改为不锚具体 revision（已有 test_migration_single_head.py 动态断言单头，本锚的价值恰在钉具体链尾，按惯例前移即可）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/tests/modules/agent/test_agent_run_log_tool_kind.py | PublishIntent 夹具补 duration_api_ms=None |
| 修改 | backend/tests/test_align_platform_change_events_migration.py | head 锚 →c515ffd62859 + 注释链续写 |
| 修改 | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | 上移/下移声明序锚 17/18/19 |
| 修改 | frontend/src/components/git-log/__tests__/git-log-page.test.tsx | TABS 数锚 16→15 |
| 重生成 | sillyhub-daemon/src/api-types.ts | gen:types 清偿 872 行漂移 |
