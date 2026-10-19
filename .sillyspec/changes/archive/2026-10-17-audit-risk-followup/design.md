---
author: flow-machine-draft
created_at: 2026-10-16T23:01:17.452Z
---
# 设计记录（Design Record）— 2026-10-17-audit-risk-followup

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

24h 审计六处发现的定点最小侵入修复：①会话载入白名单 VALID_PROVIDERS 从手写 Set 改为 INTERACTIVE_PROVIDERS 注册表键单源推导（照 session-manager PROVIDER_RELOAD_ENGINES 同款手法），消灭「装配加键、白名单漏改」缺陷类（pi/cursor/dsh+zcode 已三次踩坑）；②run 完成角标判定补 `current === null` 前置条件；③登出清理注册表补 `sillyhub:session-completed-unread:` 前缀；④防复活抑制面计算时机从 getSpecBundle 之前移到 pre_swap 之后——窗口内重建的文件盘面复存即自动退出抑制面，与既有「窗口写入=pre_swap 服务器留底+下跳心跳拉齐」语义一致；⑤zcode consume finally 补齐 codex 同位的槽位清理与兜底 close（h.closing 幂等）；⑥applyResurrectSuppress 补 relative/isAbsolute 包含性校验，越界键跳过并告警。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- spec-sync.ts：applyResurrectSuppress 由模块私有改 export（导出仅为单测可达，签名不变）；pullSpecBundle 对外可观察行为变化=抑制面现算时机后移（窗口内重建文件不再被删、不再并回陈旧 manifest 行）。
- session-store-persistence.ts：VALID_PROVIDERS 语义不变、取值源改注册表单源；validateRecord 的 provider cast 由过期字面量联合改 `PersistedSessionRecord['provider']`。
- session-list-panel.tsx / logout-storage.ts：前端内部行为修正，无接口变化。
- zcode-app-server-driver.ts：consume finally 增补清理，无签名变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：抑制面在 pre_swap 之后现算、随后立即应用，两步之间无外部事件窗口；pre_swap 之前的任意时点写入（含乱序迟到）都被现算覆盖。run 角标判定逐快照 diff，对到达顺序不敏感。
2. 并发写：抑制 loop 内 pathExists 与 rm 之间存在极窄窗口，沿用原实现容忍语义（rm force + catch 静默）；多工作区共享 specs/ 父目录时，FR-06 包含性校验阻止越界键把 rm 打出本工作区目录。
3. 切换/生命周期：zcode consume 被 close 打断时，h.closing 幂等守卫使 finally 的 `await h.close()` 立即返回（不二次杀进程）；输入队列自然关闭路径由 finally 兜底回收子进程——任何未来新增的「consume 自然退出」路径不再泄漏。
4. 作用域：VALID_PROVIDERS 单源推导后与驱动注册表天然同域（注册表加键即自动覆盖）；登出清理前缀带尾分隔符精确匹配，不误删同命名空间设备级键（sillyhub.sessions.new.machineId 先例）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：FR-04 时机后移后，pre_swap 至抑制应用之间若「已删」文件被重建，落地的是 bundle 旧内容（覆盖重建内容）——但重建内容已经 pre_swap 在服务器留底、下跳心跳拉齐自愈，无净丢失，与既有「窗口写入」语义一致，非新引入风险。试过但放弃：在抑制应用处对「窗口内重建」做内容级区分（bundle 旧内容 vs 重建内容择优保留）——需缓存窗口内写入快照并做内容合并，复杂度与收益不成比例。CLI 仓（sillyspec da8d2449 同构移植）的同类残余窗口留待后续变更同构收口。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | sillyhub-daemon/src/interactive/session-store-persistence.ts | VALID_PROVIDERS 单源推导 + provider cast 修正 |
| 改 | sillyhub-daemon/src/spec-sync.ts | 抑制面 pre_swap 后现算 + applyResurrectSuppress 越界校验/导出 |
| 改 | sillyhub-daemon/src/interactive/zcode-app-server-driver.ts | consume finally 补槽位清理与兜底 close |
| 改 | frontend/src/components/sessions/session-list-panel.tsx | run 完成判定补 current===null |
| 改 | frontend/src/lib/logout-storage.ts | 注册表补 session-completed-unread 前缀 |
| 改 | sillyhub-daemon/tests/interactive/session-store-persistence.test.ts | 单源守护用例 + 过期标题修正 |
| 改 | sillyhub-daemon/tests/pull-antiresurrect.test.ts | 用例5（窗口重建保护）/ 用例6（越界键防线） |
| 改 | sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts | consume 自然退出守护用例 |
| 改 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | running→running 不标用例 |
| 改 | frontend/src/lib/__tests__/logout-storage.test.ts | USER_KEYS 补新前缀键 |
