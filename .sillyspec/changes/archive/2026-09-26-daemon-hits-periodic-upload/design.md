---
author: flow-machine-draft
created_at: 2026-09-25T23:20:26.153Z
---
# 设计记录（Design Record）— 2026-09-26-daemon-hits-periodic-upload

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-daemon-hits-periodic-upload 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
新增 KnowledgeHitsPeriodicUploader（src/knowledge-hits-periodic.ts）：daemon.start() 里
实例化并 start（5 分钟 setInterval + unref），每轮枚举 daemonStateDir()/specs/ 下绑定工作区
（UUID 形态守卫 + 排除 .pre-junction-backup-*），按 hits 文件 mtime+size 短路键跳过未变工作区，
变化的经既有 uploadKnowledgeHitsIfNeeded best-effort 上行。选此方案：服务端行级 hash 幂等
（重报免费），双通道（postSync 即时 + 周期兜底）零重复入库；mtime 短路防每 5 分钟无谓全量读
大文件；复用既有 uploader 的断点/分批/容错语义零重复实现。


## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-daemon-hits-periodic-upload 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
改动：sillyhub-daemon/src/knowledge-hits-periodic.ts（NEW：uploader + roundOnce 纯函数导出
供测试）、src/daemon.ts（import + _hitsPeriodic 字段 + start() 接线，无 stop 面新增——进程级
生命周期与 daemon 同退）、tests/knowledge-hits-periodic.test.ts（NEW 5 用例）。
对外可见：无协议/端点变化；行为变化=hits 上行不再依赖 spec 同步成败（断流自愈窗口 ≤5 分钟）。


## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-daemon-hits-periodic-upload 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序：周期轮与 postSync 挂点并发上行同工作区——服务端 (ws, line_hash) 唯一约束去重，
双通道重报零重复；断点推进由 uploader 内部批级原子写保证。2. 并发写：CLI append 与 mtime stat
竞态最坏漏一轮（下轮补），方向安全。3. 切换：定时器 unref 不阻退出；进程被杀断点停在上批，
下轮重报由 hash 去重吸收。4. 作用域：specs/ 目录枚举即本 daemon 绑定集，UUID 守卫防杂名进端点；
不跨 daemon 实例共享状态。


## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-daemon-hits-periodic-upload 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：5 分钟周期对高频写入工作区造成上行延迟峰值——评估：遥测是运营统计非实时信令，
5 分钟粒度足够（postSync 即时通道仍覆盖同步场景）。次生：specs/ 大量绑定时每轮 stat 全集——
mtime stat 微秒级且通常绑定 ≤10，无感知。放弃方案：①挂 heartbeat 节拍（15s）——过于频繁且
heartbeat 模块职责不含 FS；②watcher 监听文件变化——Windows fs.watch 跨 junction 不可靠且
引入新基础设施；③只留周期通道去掉 postSync 挂点——同步后要等最长 5 分钟才上行，即时性回退。

## 文件变更清单

- sillyhub-daemon/src/knowledge-hits-periodic.ts
- sillyhub-daemon/src/daemon.ts
- sillyhub-daemon/tests/knowledge-hits-periodic.test.ts
