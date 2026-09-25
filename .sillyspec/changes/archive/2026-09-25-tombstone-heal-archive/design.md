---
author: flow-machine-draft
created_at: 2026-09-25T05:03:12.145Z
---
# 设计记录（Design Record）— 2026-09-25-tombstone-heal-archive

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-tombstone-heal-archive 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
收编上个会话遗留半成品（代码+测试均已就绪，实测 16 passed）。三块：①upsert_progress 已删拒收分支加复活通道——body 同名条目 status=='archived' 且行 location=='deleted' 时 _heal_deleted_row_to_archive 翻回 archive 走正常接受，否则维持原拒收；②两个私有 helper（_body_changes_status 墓碑终态判别 + 幂等翻行）；③_apply_cli_tombstone 的 archived 分支语义化 no-op（行为与原早退等价，注释钉住不软删镜像/不动 location）。与已提交的 dfdeedf27（change 侧三源并集+存量回翻迁移）互补：那侧治存量，本侧治增量通道。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-tombstone-heal-archive 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
对外 API 零签名变化（POST /progress 行为语义增强：'archived' 载荷可复活 deleted 冤案行）；模块内新增两个私有 helper，无新端点/DTO/迁移。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-tombstone-heal-archive 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序：晚到的旧 'deleted' 载荷在行已复活后到达——已删探测不再命中（location=archive）走正常 upsert，无害。2. 并发：两请求同翻一行——第二个幂等返回 False 走原分支；单写点无交叉，commit 竞态由既有会话语义兜底。3. 切换：翻行与接受分支同请求内顺序执行，无半态窗口。4. 作用域：翻行查询显式带 workspace_id，无跨工作区串台。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-tombstone-heal-archive 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：误复活真删除行——防线是判据只认「行 location=='deleted' 且载荷终态 'archived'」（真删除链本地 status='deleted' 不会再发 archived 终态；行缺失/兜底判据命中不建行）。放弃的方案：让 _apply_cli_tombstone 认 archived 置 location——与 D-002@v1 冲突（reparse 是 location owner，抢先置位会被回翻抖动），坑文档原提议已在 dfdeedf27 否决；本复活通道是拒收分支内的唯一例外写点且单向。
