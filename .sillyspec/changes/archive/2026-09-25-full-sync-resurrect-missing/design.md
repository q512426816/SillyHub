---
author: flow-machine-draft
created_at: 2026-09-25T12:38:54.862Z
---
# 设计记录（Design Record）— 2026-09-25-full-sync-resurrect-missing

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-full-sync-resurrect-missing 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
在 `spec_workspace/service.py::_write_spec_root` 的逐文件循环改「同内容跳过」分支：跳过前提从
「既有行哈希相同」升级为「既有行哈希相同 **且** 目标文件磁盘在位 **且** 行在线（exists=True）」。
`_load_member` 线程函数顺手探测 `tgt.exists()` 一并返回（不加额外 IO 轮次）；三态任一不满足即判
「复活态」（`resurrect`）：绕开 mtime 优越性判定直接落盘（move）并把行翻回在线；复活且内容一致时
不产生冲突归档行（内容相同无冲突），内容不同仍走既有归档。

选这个方案的原因：生产 c84182bc 实证「行在、哈希同、磁盘无文件」的幽灵态下，整树覆盖的全量推送
也永远写不回文件——镜像残缺直接卡死知识/扫描文档页数据；而全量语义本来就是「以 tar 为权威整树
覆盖」，磁盘缺文件时同内容跳过没有任何正当性。复活不比 mtime（磁盘侧本无现行文件可比对），
也不该归档同内容「冲突」。


## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-full-sync-resurrect-missing 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
改动文件：`backend/app/modules/spec_workspace/service.py`（`_write_spec_root` 循环内
`_load_member` 返回值 +1 元 `tgt_exists`；同哈希分支加 `not resurrect` 前提；写分支加
`resurrect or` 与 `cur.exists = True`；同内容复活不归档）、
`backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py`（新增 TestResurrectMissingFiles 三用例）。

对外可见：HTTP 端点、请求/响应结构、增量协议（apply_ops）**零变化**；变的是全量同步的落盘行为：
幽灵态文件从「永远写不回」变为「落盘 + 行翻回在线」。既有正常态（哈希同 + 磁盘已有 + 行在线）
行为逐字不变（skip 分支保留，文件 mtime 不被重写——用例钉死）。


## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-full-sync-resurrect-missing 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. **乱序/迟到到达**：复活判定只依赖本成员的「磁盘在位探测 + 既有行状态」，与成员处理顺序无关；tar 成员逐个处理，同一成员只有一次判定。
2. **并发写**：`_write_spec_root` 本身是同步端点内单线程循环（既有语义不变）；并发两次全量同步同文件的落盘结果幂等（同内容 move 覆盖）。`tgt.exists()` 探测与后续 move 之间理论上有窗口（他进程删文件）——move 仍会写回，方向安全。
3. **切换/生命周期**：探测在 `_load_member` 线程函数内（既有 IO 段），异常路径不变（FileNotFoundError 跳过成员）；复活落盘与行翻回在同一最终事务（既有提交语义），中断即整体回滚无半态。
4. **作用域**：行按 `workspace_id` 预取（既有），复活只作用于本工作区 tar 成员；`tgt` 路径已过越界校验（既有），无跨工作区串台。


## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-full-sync-resurrect-missing 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
**最大风险**：复活绕过 mtime 优越性判定，若镜像磁盘缺文件但 DB 行内容是**较新**的（他端推进、
本地 tar 是旧副本），复活会把旧内容写回磁盘。评估：全量推送语义本就是「tar 为权威整树覆盖」——
调用方（daemon/手工恢复）显式声明本地为权威；且磁盘缺文件时镜像对该路径**无现行内容**可比，
不存在「覆盖新内容」，DB 行内容已由冲突归档路径保留（内容不同时归档再写）。可接受。

**次生风险**：`tgt.exists()` 给每个同哈希成员加一次 stat（约数千次/全量）——Linux ext4 上 stat
为微秒级且已在既有 IO 线程段内，实测本地 8857 成员全量 71s 无退化感。

**试过但放弃的方案**：
1. 复活时也归档冲突行（无论内容是否一致）——同内容归档是纯噪音（生产将产生大量空冲突史），弃。
2. 在 reparse 阶段顺带补缺文件——reparse 是 docs/ 域的行管理面，职责不符且拿不到 tar 内容，弃。
3. 只判 `cur.exists`（行软删）不判磁盘在位——生产实证存在「行在线 + 磁盘缺文件」形态（converge
   削文件不削行的窗口），漏判，弃。

## 文件变更清单

- backend/app/modules/spec_workspace/service.py
- backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
