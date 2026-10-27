---
author: flow-machine-draft
created_at: 2026-10-27T07:04:27.238Z
---
# 设计记录（Design Record）— 2026-10-27-task-parser-md-check-fallback

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

改 backend/app/modules/task/parser.py 单文件：`parse_tasks` 预读 tasks.md 建 key→勾选映射（`md_checked`），卡片解析（`_parse_task_file` 新增 `md_checked: bool | None = None` 参数）在 frontmatter **未显式写 status 键**时用该映射回退（[x]→done、[ ]→draft、无行→draft）；显式 status 仍优先（靠键存在性区分「未写」与「写了 draft」）。选此方案因根因实证明确（2026-10-28-bg-task-status-report：tasks.md 7/7 全勾解析全 draft——CLI 勾选协议活在 tasks.md checkbox，TaskCard 模板无 status 键，旧「卡片优先跳过注册表行」让勾选态无处进表），平台侧单点修复即通，不动 CLI/前端。注册表行循环仍只补卡片未覆盖 key（thin 单源零回归）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

`TaskParser._parse_task_file` 签名加可选尾参 `md_checked: bool | None = None`（模块内部私有方法，无外部调用方）；`parse_tasks` 对外签名与返回结构零变化——唯一行为变化：厚档双源同 key 时卡片 status 从「恒 draft」改为「无显式 status 时回退 tasks.md 勾选态」。无端点/命令/文件格式改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：tasks.md 与卡片的读取在单次 parse_tasks 调用内同拍完成（先 md 后卡），不存在跨调用乱序；reparse 周期性重解析幂等（同输入同输出）。
2. 并发写：parser 是纯读快照（读文件→内存解析），与 agent 勾选文件的竞态只影响本拍解析结果，下拍 reparse 自愈——与修复前语义一致。
3. 切换/生命周期：无状态变更（无 session/请求态）；解析中断最多产出半批 tasks + warning，与修复前一致。
4. 作用域：解析按 change_rel_path 逐变更目录隔离，md_checked 映射是调用内局部变量不跨变更——无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：卡片 frontmatter 显式写了 `status: draft`（人工想强制 draft）的场景会被误回退为 done——已靠键存在性区分（显式 draft 优先于勾选态）消除；残留面是极旧的卡写了 status 但语义与勾选冲突（未见实例，reparse 幂等可观察）。放弃方案：①改 CLI 让 task-tick 同步写 TaskCard frontmatter status——跨工具改动（sillyspec CLI），平台侧修不动上游，且 TaskCard 是执行卡非状态源的模板约定会被打破；②reparse 后置覆盖（先解析卡再用 tasks.md 覆盖同 key）——与「卡片富信息优先」docstring 声明正面冲突且丢显式 status 语义，不如解析内回退干净。
