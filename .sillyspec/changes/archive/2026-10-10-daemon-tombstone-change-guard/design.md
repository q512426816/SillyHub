---
author: flow-machine-draft
created_at: 2026-10-09T23:47:00.931Z
---
# 设计记录（Design Record）— 2026-10-10-daemon-tombstone-change-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

24h 审查发现：墓碑隔离执行器（runTombstoneCleanup）在 daemon 侧用 `join(pre.cwd, '.sillyspec', 'changes', change)` 直接拼接路径并 `renameSync` 整目录移动，而 daemon.ts 入口只校验 change 非空字符串；后续 doctor 命令数组不含 change，CLI 的 assertSafeChangeName 对该值不生效——路径穿越形态的 change 若经任一下发入口到达 daemon，可把工作区目录树外的同盘目录移进隔离区。当前两条入口（backend 手动端点白名单 + 自动环 DB change_key 均为目录名派生）都拦住了它，但纵深防御为零且两端注释互相声称对方有校验。方案：在 daemon.ts 消息入口加与 backend machines.py 同款的白名单正则 `SAFE_CHANGE_NAME_RE`，非法即 warn 丢弃（与既有「缺字段 warn 丢弃」同模式、同层）；同时把 sillyspec-manager.ts 与 machines.py 两处虚假注释改写为如实分工描述。选入口层而非执行器内部校验：入口是所有下发路径的必经点，一层拦截全路径；执行器保持纯执行职责。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sillyhub-daemon/src/daemon.ts`：新增模块级常量 `SAFE_CHANGE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`；`_handleWsMessage` 的 `MSG.SILLYSPEC_TOMBSTONE_CLEANUP` 分支在非空校验后追加白名单校验，不匹配 → warn `sillyspec_tombstone_cleanup_invalid_change`（change 截断 160 字符）后 break。对外协议（消息类型/payload）零变化；合法 change 行为零变化（透传语义用例不动）。
- `sillyhub-daemon/src/sillyspec-manager.ts` 与 `backend/app/modules/daemon/router/machines.py`：仅 docstring 注释改写，无代码行为变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立：校验在消息分发入口同步执行、无状态，乱序/迟到消息每条独立过同一正则，结果与到达顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   无影响：正则为纯函数、常量无共享可变状态；校验通过后路由进既有 FIFO 命令队列（_runSillySpecCommand 串行），不新增并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全：校验失败即丢弃（fire-and-forget warn），无半态；校验通过走既有队列生命周期，中断语义与本变更前完全一致。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会：正则只约束 change 字符集，与 workspaceId 解耦；跨工作区/多实例下发各自独立过同一白名单，无跨域共享状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：白名单过严误伤合法 change 名（如未来出现含中文/空格的目录名）——现网 change_key 全部为 `YYYY-MM-DD-<slug>` 形态（目录名派生），正则与 backend 手动端点已长期同款，收紧面两端一致，误伤面为零增量。试过但放弃：在执行器 `_requireCommandPrecondition` 内加校验——该方法被 resolve/ghost_cleanup/tombstone_cleanup 三路共用，resolve 路径 change 经 CLI 数组形参已有 assertSafeChangeName，重复校验混淆守卫分工；且消息入口层一层拦截覆盖所有下发路径，更完整。

## 文件变更清单（自声明）

交付文件（7 个）：

1. `sillyhub-daemon/src/daemon.ts`——SAFE_CHANGE_NAME_RE 常量 + TOMBSTONE_CLEANUP 分支白名单校验（task-01）
2. `sillyhub-daemon/src/sillyspec-manager.ts`——_requireCommandPrecondition docstring 如实化（task-02）
3. `backend/app/modules/daemon/router/machines.py`——请求体 docstring 如实化（task-02）
4. `sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts`——非法形态 it.each 7 用例（task-03）
5. `backend/openapi.json`——machines.py docstring 变化的生成物镜像（规则 21 债务清偿，评审 P3-1 处置）
6. `frontend/src/lib/api-types.ts`——同上生成物镜像
7. `sillyhub-daemon/src/api-types.ts`——同上生成物镜像
