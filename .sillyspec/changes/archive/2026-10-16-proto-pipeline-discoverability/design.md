---
author: flow-machine-draft
created_at: 2026-10-15T16:20:00.000Z
---
# 设计记录（Design Record）— 2026-10-16-proto-pipeline-discoverability

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

纯文档+配置双堵：①multi-agent-platform 图 scan CONVENTIONS.md 加「前端原型管线」指针节——三会话对照实证（change-detail-redesign 找到管线 vs knowledge-search/server-logs 误判无管线）的根因是 PROTOTYPE.md/FRONTEND_PAGE_STYLE.md 只在 SillyHub 图，本图 agent 查本图 scan 面零命中；指针节让本图 scan 面自带管线入口与规约指向。②local.yaml 登记 ui_prototype: { form: real-code }——sillyspec 2026-10-15 新契约（本仓工具链 symlink 实时生效），登记后 UI 须知从「未登记强提醒」转「真码契约」态，且 local.yaml 是用户所有物、scan 重扫永不覆盖（CONVENTIONS.md 指针节有全量重扫丢失风险，成本接受——管线本体在 frontend/ 仓内天然可发现，指针是加速器不是唯一通道）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- CONVENTIONS.md 追加一节（不改既有节）；local.yaml 顶层追加一段（YAML 合法性以 readUiPrototypeForm 解析成功为准）。
- 零代码面：不触 frontend/src、backend/、sillyhub-daemon/。
- 消费方：sillyspec readUiPrototypeForm/resolveUiPrototypeFor（repos 注册含 sillyspec 子仓——本登记为仓级，触达 frontend 的变更按仓级生效）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：两文件独立落盘，读侧（须知渲染）即时读即时生效；无时序假设。
2. 并发写：平台仓有活跃并行会话（change-detail-redesign 在途）——提交用显式 pathspec 只带本变更两文件，不碰他人暂存面。
3. 切换/生命周期：local.yaml 持久；CONVENTIONS.md 若遇全量重扫丢失指针节，管线仍可经 frontend/PROTOTYPE.md 惯例位与 knowledge 检索发现（降级面可接受）。
4. 作用域：指针路径用仓内相对路径（.sillyspec/docs/SillyHub/scan/...），跨平台路径形态无关；ui_prototype 为仓级登记，multi-agent-platform 图与 SillyHub 图变更均消费同一 local.yaml（同根 specBase）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险1：CONVENTIONS.md 全量重扫覆盖指针节。对策：接受（重扫由人触发且低频；local.yaml 登记位与注释永不丢失，是持久底座）。
- 风险2：YAML 手写缩进错导致解析失败回落未登记态。对策：FR-03 以 readUiPrototypeForm 实测登记成功为验收；失败即修。
- 死路：考虑过把两份规约复制落档到本图 scan 面——放弃：双源必漂移（PROTOTYPE.md 是活文档）；指针优于副本。
