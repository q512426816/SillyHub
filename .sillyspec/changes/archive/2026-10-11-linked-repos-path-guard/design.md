---
author: flow-machine-draft
created_at: 2026-10-11T04:49:03.217Z
---
# 设计记录（Design Record）— 2026-10-11-linked-repos-path-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

24h 审查 P3-2：daemon 的 linked_repos_snapshot/linked_repos_sync 对 root_path 仅非空校验即用作 CLI 的 cwd 与参数，rel_path/abs_path 仅 trim 直传写命令，而 backend 侧 MyPathUpdate.path 只限长度不限形态——daemon 无第二道边界，backend 数据被污染或未来新增调用方时即成任意路径执行跳板。修复为**形态校验**（最小且不破既有约定）：新增纯函数 `isAbsoluteLikePath`（POSIX `/` 根、Windows 盘符 `X:`、UNC `\\\\`/`//` 三形态任一即真——不用裸 `path.isAbsolute`，它平台相关，Linux CI（ubuntu-latest）会拒 `C:/` fixture）；两条例程入口对 root_path 非绝对形态抛错（payload 级=RPC 错误，对齐 handler 缺参语义）；sync 逐仓 rel_path 须**相对**形态（`../` 兄弟仓是既有合法约定，不禁 `..`）、abs_path 须**绝对**形态，违者该层 `failed` 结果体不 spawn（数据级失败，对齐模块「能力降级与命令失败都是数据不是异常」契约）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 `sillyhub-daemon/src/linked-repos-path.ts`：导出 `isAbsoluteLikePath(p: string): boolean` 纯函数（正则三形态：盘符 / UNC 反斜双 / UNC 正斜双 / POSIX 根；空串与相对形态 false）。
- `linked-repos-snapshot.ts` `runLinkedReposSnapshot`：入口守卫——root_path 非绝对形态 throw `Error('linked_repos_snapshot: root_path 非绝对路径')`（先于 resolveBin，坏形态不触任何外部调用）。
- `linked-repos-sync.ts` `runLinkedReposSync`：入口同款守卫（先于 bin 解析与循环）；逐仓 rel_path 绝对形态 → `{layer:'projects_yaml', status:'failed', detail:'约定相对路径非法（须相对路径）'}` 不 spawn；abs_path 相对形态 → `{layer:'repos_registry', status:'failed', detail:'本机路径非法（须绝对路径）'}` 不 spawn；合法形态逐字透传（toPosix 既有口径）。
- daemon.ts 两个 RPC handler、backend、协议帧格式：零改动（「无」——校验下沉在例程内，handler 缺参 throw 语义保留）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：请求-响应 RPC，例程无状态；校验在入口/逐条同步点做，与到达顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：校验是纯函数读；既有串行 spawn（R-07 一次一条命令）不变，同步例程无并发面变化。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

逐仓 failed 不中断循环（后续仓照常处理）、report 回调照常携带全部结果；root_path 抛错发生在任何 spawn 之前，无半执行态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

校验按 payload/条目自身做，无跨工作区状态；root_path/abs_path 的绝对路径内容不加白名单（用户登记本机任意仓库是功能本体），形态校验不引入机器归属判定（归属由 backend 绑定行既有语义负责）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：形态校验挡不住「合法形态的恶意绝对路径」——但那正是功能本体（用户登记自己机器上的任意路径），真正的边界在 backend 归属校验与 sillyspec CLI 自身的写入范围，本变更是把「垃圾/相对形态导致的 cwd 漂移与未定义行为」关掉（纵深防御第二道），不冒充完整授权模型。声明边界：`..` 段在 rel_path 合法（兄弟仓约定）、在 abs_path 不受限。

放弃的方案：① 裸 `path.isAbsolute`——平台相关，ubuntu-latest CI 上 `C:/` fixture 全线假红；② rel_path 禁 `..` 段——打翻既有 `../platform-specs` 兄弟仓约定（fixture 实证），把合法流判成非法；③ daemon 侧维护「已登记路径白名单」——daemon 无 backend 登记面视图，引入状态同步问题且与 RPC 请求-响应模型相悖。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | sillyhub-daemon/src/linked-repos-path.ts | isAbsoluteLikePath 纯函数 |
| 修改 | sillyhub-daemon/src/linked-repos-snapshot.ts | 入口 root_path 形态守卫 |
| 修改 | sillyhub-daemon/src/linked-repos-sync.ts | 入口守卫 + 逐仓 rel/abs 形态校验 |
| 修改 | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | 相对形态抛错/三形态放行用例 |
| 修改 | sillyhub-daemon/tests/linked-repos-sync.test.ts | root_path 守卫 + 逐层 failed 用例 |
