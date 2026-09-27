---
author: flow-machine-draft
created_at: 2026-09-25T05:20:23.143Z
---
# 设计记录（Design Record）— 2026-09-25-spec-sync-pg-chunk

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-spec-sync-pg-chunk 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
apply_ops 的 pending_adds 批量 upsert 按 500/批分片执行（原一次性 values([...]) 在单批数千行时绑定参数超 asyncpg 32767 上限 → spec-sync 500 全链瘫痪）。行级 upsert 语义逐字不变（同 on_conflict_do_update，幂等），批大小含 8 倍安全余量（500 行 × 8 参 = 4000 参）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-spec-sync-pg-chunk 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
对外 API 零变化（POST /spec-workspace/sync-incremental 行为修复：大批不再 500）；模块内常量 _ADD_CHUNK=500 分片循环，无 schema/迁移。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-spec-sync-pg-chunk 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序：ops 顺序处理语义不变，分片只切 manifest 批量写，文件落盘仍逐 op 顺序。2. 并发：upsert 幂等 + 版本高位对齐 case 保留，跨批并发重放与原单语句语义一致。3. 切换：中途失败回滚同事务语义（分片在同一 session/事务内，失败整体回滚不变）。4. 作用域：rows 自带 workspace_id，分片不改变归属过滤。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-spec-sync-pg-chunk 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：批间非原子（部分批成功后后续批失败）——原语义同为单事务内多语句，失败整体回滚，原子性不变；幂等重放由 conflict 跳过兜底。放弃的方案：改 executemany 或拆多请求——前者失去 on_conflict_do_update 的版本高位对齐语义，后者改 CLI 契约，均过重。
