---
author: flow-machine-draft
created_at: 2026-09-26T14:45:56.806Z
---
# 设计记录（Design Record）— 2026-09-26-probe-concurrent-rpc

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-probe-concurrent-rpc 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
三处最小侵入修复，不动 daemon 侧、不动响应契约：
1. `delegate.py` 新增 `_PROBE_RPC_TIMEOUT_SECONDS = 3.0`，`probe_workspace_git_mode`（stat）与 `git_remote_url`（git_remote）两条探测通道把默认 30s 传输预算收紧为 3s——探测是 UI 弹层实时路径，daemon 真答秒级完成，超时照旧归 unknown/None（fail-safe 语义不变），只是放弃更早。选 3s 而非更长：生产实测跨公网 daemon 单次 2-12s，3s 让「daemon 半死」的尾部不再拖垮整批。
2. `orchestrator.collect_many_workspace_statuses`：原 for 循环逐个 `await git_probe(ws)` 改为先 `asyncio.gather` 并发探测、后按 workspaces 原序组装——批量耗时从 N×单次 RPC 累加降为最慢一个。探测回调的 RPC 段不碰 session；其内部 daemon_id 解析段（默认 resolver 用共享 AsyncSession 查库）由 delegate 实例锁 `_daemon_id_resolver_lock` 串行化（AsyncSession 单任务约束），毫秒级解析串行、秒级 RPC 并发。
3. `workspace/router.py` probe 端点：未识别 repo_url 的 git 态工作区原先在组装循环里逐个 `await git_remote_url`，改为先收集 pending 索引、gather 并发预取再组装；已识别短路（ql-20260918-012 零 RPC）与回填副作用语义原样保留。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-probe-concurrent-rpc 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
对外签名零变化：`POST /api/workspaces/probe` 响应字段（workspace_id/git_mode/daemon_name/daemon_online/repo_url）、三态取值、回填副作用、日志事件（host_fs_rpc_failed）全部不变。内部变化：
- `HostFsDelegate.probe_workspace_git_mode` / `git_remote_url` 的 RPC 传输预算从默认 30s 变为 3s（`_PROBE_RPC_TIMEOUT_SECONDS`）——唯一可观测差异是超时类失败来得更早（原 30s 才归 unknown/None，现 3s）。
- `collect_many_workspace_statuses(session, workspaces, *, git_probe)` 签名不变，git_probe 回调从串行变并发调用；回调内部触碰共享 session 的 daemon_id 解析段由 delegate 实例锁串行化（回调其余部分为纯 WS RPC）——直接用 session 做其它查询的自定义回调不受本变更保护，需自行保证并发安全。
- 新增测试常量引用：`_PROBE_RPC_TIMEOUT_SECONDS` 被 test_probe_endpoint.py import 用于断言。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-probe-concurrent-rpc 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：gather 结果按 workspaces 下标原序回填组装，条目顺序与串行版完全一致；迟到/慢 RPC 由 3s 预算截断，不存在乱序落位问题。
2. 并发写：探测回调（stat/git_remote RPC）只读不写；唯一写副作用 repo_url 回填仍在组装循环（gather 之后）串行执行 + 单次 commit，与原实现一致，无新增并发写面。gather 并发段触碰共享 AsyncSession 的唯一路径是 delegate 内 daemon_id 解析（默认 resolver 单条 SELECT）——已由 delegate 实例锁串行化（评审 P1 修复），不会出现并发 execute；解析失败的异常路径与原串行版一致（HostFsDelegateUnavailable / 降级集）。
3. 切换/生命周期：请求中途断连时 FastAPI 取消任务，gather 随之取消，RPC 无残留写；无跨请求状态（R-02 每次实时探测不缓存，未引入缓存）。
4. 作用域：探测按 workspace 各自的 binding 路由到各自 daemon，gather 并发不改变路由规则；不同工作区结果按下标本位组装，不会串台。同一 daemon 被多工作区绑定时并发发多条 stat RPC——daemon 侧 host_fs handler 本就按请求并发处理（WS 多路复用），无串台。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-probe-concurrent-rpc 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：把 3s 预算设得比真实慢链路还短——daemon 在线但公网高抖动（>3s）时探测会从「慢但有真答」变成「unknown」。权衡依据：探测是三态 UI 展示（unknown 时界面照常显示「未知」并维持现状路径，§5.D），拿不到真答的代价只是显示降级，而 30s 预算下整批探测拖分钟级的代价是用户可感的全局卡顿；且单次 stat 本地执行毫秒级，3s 已含 ~3 个数量级的网络余量。
试过但放弃：给 git_probe 结果加 TTL 缓存（比如 30s 内复用）——被 R-02「每次调用实时探测不缓存」明确否决，且缓存会让「daemon 刚下线/刚变 git 态」的展示滞后，违背探测语义，放弃。
次要风险：gather 不开 return_exceptions，若未来有 git_probe 实现抛异常，并发版会在首个异常时与其余在飞任务一起快速失败——与原串行版「首个异常中断」语义一致，不视为回归。
