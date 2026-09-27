---
author: flow-machine-draft
created_at: 2026-09-27T14:21:02.878Z
---
# 设计记录（Design Record）— 2026-09-27-timeline-task-time

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-task-time 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
复刻 CLI watcher timeline 的 inferFlipTimes 到平台合成时间线：timeline.py 新增 _infer_task_times 纯函数（task-done 事件的 checked N→M 计数游标衔接赋值、中段断裂停止、尾部未勾不标断裂），TimelineTask 加 time 字段回填；前端任务面加 ≈HH:mm:ss 时刻列（已勾无时刻显示 ?，未勾不显示）。detail 匹配用 search 子串——兼容 watcher 现行「stage · checked N→M」前缀形态与旧裸格式。事件数据源是已回填平台库的 watcher 事件（本变更前置：watcher 推送端点修复+历史回填已另行完成）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-task-time 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
GET /changes/{cid}/timeline 响应 TimelineTask 新增可选字段 time（str|null，翻格推断勾选时刻 ISO）；additive 无破坏。后端 schema.py + timeline.py + test_timeline.py（金样本补断言 + 专项用例）；openapi.json 再生 + 前端 api-types.ts 再生（gen:types --force，生成物）；前端 change-timeline-card.tsx 任务面时间列 + 组件测试断言。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-task-time 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：事件轴按 ts 字符串正序读取后游标推进——晚到事件 ts 在序列中天然有序（表按 ts 排序），推断与到达顺序无关；重复事件被去重键吸收，计数幂等。
2. 并发写：不适用——只读聚合，无写路径；推断纯函数无共享状态。
3. 切换/生命周期：请求级计算零残留；断裂/盲窗语义显式（None + 前端 ?），不冒充完整历史。
4. 作用域：事件按 (workspace_id, change_name) 过滤，多工作区同变更名不串台（既有查询谓词）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-task-time 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：tasks.md 行序与事件勾选计数序错位（人工重排行/中间插行）会标错时刻——CLI 同款固有语义，卡上已恒定标注「≈顺序推断」脚注，可接受。试过放弃：把推断下推到 watcher 推送时带任务 id（需改 CLI 事件协议且历史数据无法回填，放弃——推断层纯展示零协议负担）。
