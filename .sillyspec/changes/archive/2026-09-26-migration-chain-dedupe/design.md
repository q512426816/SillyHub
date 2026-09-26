---
author: flow-machine-draft
created_at: 2026-09-26T15:43:04.972Z
---
# 设计记录（Design Record）— 2026-09-26-migration-chain-dedupe

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-migration-chain-dedupe 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
四步单线化 + 一条矫正迁移，不改任何业务代码/ORM/接口：
1. 删 20260926063000（change-events-r18-full 的重复建表分支）与 merge 3931ff71bd32；083000 的 down_revision 从 063000 改接主线 20260923090000——链恢复单线 22194500→040000→090000→083000→234000。
2. 重写 20260923040000 的 create_table DDL 为与 ORM（PlatformChangeEventORM）完全一致（ts varchar(64)、severity varchar(16) NOT NULL default 'info'、rule NOT NULL、provisional server_default true、detail Text、无 stage）。选「重写旧迁移」而非「保留两份加 guard」：063000 与 040000 是同一张表的两个平行作者，留两份（哪怕幂等 guard）会让全新库按图序执行两遍建表逻辑、审计面双份；040000 记号已在线上库存在，重写其 DDL 不影响任何已应用库（记号在即不执行），只为未来新库定义正确结构。
3. 新增 20260926234000 条件矫正迁移：对被旧版 040000 DDL 建表的 PG 库幂等对齐（ts timestamptz→varchar(64) 数据转 ISO 串、severity/rule NULL 回填+类型/约束收紧、detail→text、DROP stage），每步按 information_schema 探测——目标结构库（本地 dogfood，063000 建表）全 no-op；SQLite 测试库方言短路。
4. stage 列 119/166 行非空历史值随列 DROP 废弃：旁路观测数据（只展示不消费），063000/ORM 语义已无此列，不值得为废弃观测字段写数据迁移——丢弃口径在此记录。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-migration-chain-dedupe 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
对外接口/ORM/业务代码零变化。变更面仅 migrations/versions/（4 文件）+ tests/（新增守护测试）：
- 20260923040000：revision/down_revision 不变（20260923040000/20260922194500），仅 upgrade/downgrade 的 DDL 内容重写——已应用库不受影响，全新库按 ORM 结构建表。
- 20260926083000：down_revision 20260926063000 → 20260923090000（记号与 DDL 不变）。
- 20260926234000（新增，head）：down_revision 20260926083000；upgrade 仅 postgresql 方言干活、downgrade no-op（结构对齐不可逆）。
- 20260926063000 / 3931ff71bd32：文件删除（versions 目录不再含这两个 revision）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-migration-chain-dedupe 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：alembic 按版本图拓扑序执行，单线后无分支顺序歧义；矫正迁移的探测-执行在单事务内顺序进行，无乱序面。
2. 并发写：迁移由 entrypoint 启动时单进程执行（alembic upgrade head && uvicorn），无并发写面；矫正迁移的 UPDATE/ALTER 幂等（WHERE 条件限定），重复执行安全。
3. 切换/生命周期：部署中途失败（如 ALTER 半途）——alembic PG 事务性 DDL 整体回滚，库停在 083000，重部署断点续跑；已 stamp 到新链的库回滚旧镜像会因 alembic 找不到 234000 起不来（记号超前），回滚路径=镜像回滚+psql 把 alembic_version 退回 083000（运维口径，交付汇报列明）。
4. 作用域：变更仅 platform 自有表 platform_change_events，无跨表 FK 联动（该表只被 workspaces.id FK 引出，本迁移不动该 FK）；ts 数据转换按行独立，无跨行依赖。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-migration-chain-dedupe 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：重写 040000 DDL 造成「文件内容与历史已应用效果不一致」的审计歧义——某库记号 040000 但表结构可能是旧版也可能是（未来的）新版，只能靠矫正迁移的存在与 information_schema 探测兜底对齐。缓解：040000 docstring 显式记重写历史与适用边界；矫正迁移 234000 紧随其后，任何路径到达 head 后表结构唯一确定（幂等探测保证收敛，与起点结构无关）。
试过但放弃：①给 063000/040000 加「表存在则跳过」幂等 guard 保留双文件——放弃：全新库仍按图序执行两份建表逻辑，且两条分支结构不一致（stage 列有无），guard 掩盖而非消除分叉，链图审计面双份；②ts 转 ISO 用 ts::text——放弃：输出「2026-09-25 06:04:02.526+00」（空格分隔、+00 后缀）与 service 层写入的 ISO 8601 格式不一致，混合格式破坏字典序比较一致性，用 to_char 统一 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'。
次要风险：stage 历史值丢弃（119 行）——观测数据无消费方，接受；severity NULL→'info'（157 行）与 rule NULL→'' 的回填值是语义近似（历史写入端未归一），展示层无差别。
