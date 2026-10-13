---
author: qinyi
created_at: 2026-10-13T16:05:00+08:00
---
# 设计记录（Design Record）— 2026-10-13-session-changefiles-archive-gate

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户实测反馈：某变更已归档，悬浮面板仍显示「进行中」。根因：平台侧「已归档」是两套独立信号——`status='archived'`（CLI 归档 progress 上行 → ingest 落库/读时投影，平台设计明确「不动 location」）与 `location='archive'`（reparse 扫描文件系统目录收敛）；平台既有终态口径是**双条件**（`changes/page.tsx:226` isTerminalChange 注释「终态可测试定义」、`[cid]/page.tsx:68`、`mobile-change-detail.tsx:499` 三处同源），而本面板首版只认 `location` 单信号——归档信号只到 status 侧（或 location 未收敛）时误报「进行中」。修法：新增导出纯函数 `isArchivedChange(c) = c.status === "archived" || c.location === "archive"`，`splitByArchive`/`stageLabel`/弹窗 Select 选项 label 三处判定统一走它（对齐平台口径，与变更中心行为一致）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外 API/端点/数据格式变化。组件内新增导出 `isArchivedChange(c: Pick<ChangeSummary,"status"|"location">): boolean`（测试导出面）；`splitByArchive` 与 `stageLabel` 的判定口径从单条件改双条件（行为变化：status 归档信号先到而 location 未收敛时，归组/标签从「进行中」修正为「已归档」）；弹窗 Select 选项 label 的「已归档」后缀判定同步走双条件。组件对外 props 零变化。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/session-change-files-hover.tsx | 新增 isArchivedChange 双条件 helper；splitByArchive/stageLabel/Select label 三处统一走它 |
| 修改 | frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | 新增 status=archived+location=active 面板用例与 splitByArchive 双条件纯函数断言 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：已覆盖——本修复正是为「两套信号到达时序不一致」（status 先到、location 后收敛）设计：双条件取并集，任一信号先到即正确归组；两套都未到（归档未同步）时显示进行中，与变更中心一致（服务端数据面缺失，非判定缺陷）。
2. 并发写：不适用——纯渲染期判定纯函数，无共享状态/写入面。
3. 切换/生命周期：不适用——判定为每次渲染即时计算，无缓存/订阅；轮询刷新（15s）会把后到的 location 收敛自动反映到分组。
4. 作用域：不适用——判定仅消费单行 summary 字段，无跨工作区/跨实例数据面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：双条件口径若未来平台终态定义演进（如引入第四态），本 helper 需同步——缓解：helper 注释锚定三处同源文件（page.tsx/[cid]/page.tsx/mobile-change-detail.tsx），平台口径变更时 grep 可见。试过但放弃的方案：把判定改为依赖后端新增 computed 字段（如 `is_archived`）——需后端 schema 变更+gen:types，收益与前端两字段并集等价，成本不成比例（YAGNI）。已知边界：两套信号都未到平台时仍显示进行中——此为服务端同步面问题（需项目侧补推 progress 或平台 reparse 收敛），非本判定可解，已在用户反馈处置中说明。
