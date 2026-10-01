---
author: flow-machine-draft
created_at: 2026-10-01T11:23:25.837Z
---
# 设计记录（Design Record）— 2026-10-01-review-followup-reset-guard-machineid

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-01-review-followup-reset-guard-machineid 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
24h 审查观察项 1/3 两个独立小修：(a) `helpers.reset_tool_report_session` 的会话查询补 `col(AgentSession.deleted_at).is_(None)`——takeover 路径同款查询已有该守卫，reset 是同族端点却漏了，软删会话可被属主重置并广播事件；(b) `sillyhub-daemon/src/config.ts` 的 `readOrCreateMachineId` 注释宣称「原子落盘」但实现是裸 `writeFile` 且无并发互斥（CLAUDE.md 规则 18 注释/实现不一致），改为 uuid 形状校验 + `wx` 独占创建 + 冲突回读胜者 + 非 uuid 形损坏覆写自愈，注释改为如实描述。两处均为行级修补，不动接口形状。
## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-01-review-followup-reset-guard-machineid 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
后端 `POST /api/daemon/sessions/{id}/reset-tool-report`：对外签名不变，行为收窄——软删（`deleted_at` 置位）会话从「可重置 200」变为「404 DaemonSessionNotFound」（404 语义与既有不存在分支一致，无新错误码）。daemon `readOrCreateMachineId()`：导出签名不变，返回值语义增强——文件内容非 uuid 形时不再原样采纳而是覆写自愈；并发首启由 last-write-wins 改为先写者定型。
## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-01-review-followup-reset-guard-machineid 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——两个函数都是单请求/单文件读改写，无事件序依赖。
2. 并发写：reset 走既有 `user_id + id` 查询后单行写，风险面不变；machine-id 用 `wx`（O_EXCL|O_CREAT）独占创建，并发首启先写者定型、后写者 EEXIST 回读胜者，消弭原 last-write-wins 漂移。
3. 切换/生命周期：daemon 写失败（只读 fs）仍返回内存值 best-effort（原语义保留，不阻塞心跳）；半写残片因 uuid 形状校验不达标，下次读取触发覆写自愈。
4. 作用域：machine-id 随 `SILLYHUB_DAEMON_DIR` 隔离（测试重定向不污染真实身份文件）；reset 查询补的守卫与 takeover 完全同款，无跨工作区串台面。
## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-01-review-followup-reset-guard-machineid 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：machine-id 收紧「非 uuid 形即覆写」可能误伤手工预置的非标准身份串（如有人手写短码）——但协议文档明约「纯文本 uuid（36 字符）」，非 uuid 形本就是损坏态，误伤面为零。试过但放弃：temp+rename 真·原子替换——两个并发写者各自 rename 仍是 last-write-wins，不解决本问题主矛盾（并发双生成漂移），反而多一次跨平台 rename 语义差异（Windows 目标被占用 EPERM）面；wx 独占创建 + 回读胜者用更小的面收敛同一目标。