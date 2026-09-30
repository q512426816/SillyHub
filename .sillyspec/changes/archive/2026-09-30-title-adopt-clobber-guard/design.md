---
author: flow-machine-draft
created_at: 2026-09-30T00:34:57.823Z
---
# 设计记录（Design Record）— 2026-09-30-title-adopt-clobber-guard

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-title-adopt-clobber-guard 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
收敛「title 兜底形态」判定到 title_norm.is_fallback_display_title 一处（空 / 等于 change_key / 等于去日期前缀语义名 / 裸模板 H1 文本四态；裸模板文本入列是既有回归 test_existing_row_title_refreshed 的语义——raw 模板标题无语义、须可被重派生刷新），配 TITLE_MAX_LEN=500（与 Change.title String(500) 同宽）。三条 title 写路径统一规则：兜底形态可被任一来源升级；语义标题（自定义 H1 / CLI 收养概括）只被自定义 H1（--title 改名通道，派生值非兜底形态）覆盖，不被兜底形态回翻。落点：① platform_sync `_ensure_change_row` 收养段判定换助手 + body_title 截断 + commit 包 try/except best-effort，占位建行 title 同口径截断；② `_sync_change_title_from_documents` 派生值兜底且既有语义标题时跳过覆盖；③ change `_apply_parsed`（reparse）同规则守卫。选此方案而非给收养标题加「来源标记」字段：三写路径只差一个纯函数判定，无 schema 变更、无迁移，判定收敛后 reparse 与 documents 的既有同源幂等（title_norm 2026-09-16 收敛）不受扰。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-title-adopt-clobber-guard 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
对外端点签名零变化。行为变化三处：① POST /changes/{name}/progress——body.changes[].title 超过 500 字时落库值截断为前 500 字（此前超长值在 Postgres 会让请求 500，SQLite 测试库静默存全量）；收养写库失败（DB 故障）降级为告警日志 platform_sync.change_title_adopt_failed，上行仍 200。② documents 推送 / reparse——派生 title 为兜底形态（key 派生名）而库里已是语义标题时不再覆盖（此前无条件覆盖，收养标题被回翻）；自定义 H1 派生值恒覆盖不变。③ title_norm 新增纯函数 is_fallback_display_title(title, change_key) -> bool 与常量 TITLE_MAX_LEN（无新依赖）。CLI 契约（≤50 字概括）不受影响。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-title-adopt-clobber-guard 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：收养（progress）与文档派生（documents/reparse）到达顺序无关化——两方向都不回翻语义标题；模板 H1 迟到推送不再冲掉收养值（本次主缺陷）。若用户把自定义 H1 改回模板形态，标题保留旧语义值不回退——与收养守卫同语义（兜底永不赢过语义），接受此权衡。
2. 并发写：收养写包 try/except + rollback，失败仅告警（占位建行 race-lost 同范式）；documents 侧本有 begin_nested + IntegrityError/Exception 双兜底；reparse 单事务。两进程同时收养同一行：后 commit 者胜，值都是 CLI 同源概括，无撕裂。
3. 切换/生命周期：收养失败 rollback 后 existing 身份映射过期对象随即 return 不再被读，无脏属性外泄；progress 上行主流程（_apply 已 commit 的进度行）不被收养失败拖垮。
4. 作用域：判定与写入均带 workspace_id + change_key 双键，无跨工作区串台面；is_fallback_display_title 为纯函数无状态。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-title-adopt-clobber-guard 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：兜底判定把「裸模板 H1 文本」也算兜底——若作者刻意把自定义标题写成恰命中 TEMPLATE_H1_RE 的纯类型词文案（如就叫「提案书」），其标题会被收养/重派生刷新掉。该口径与 normalize_display_title 既有判定同源，非新标准；真实碰撞面可忽略。放弃的方案：a) Change 加 title_source 标记列区分收养/派生来源——需 schema 变更且两文档路径都要改判定，收益不抵复杂度；b) 只守 documents 路径不守 reparse——审查实证 _apply_parsed 同样无条件覆盖，漏守即缺陷残留（test_apply_parsed_fallback_keeps_semantic_title 先红实证）。遗留（超出本变更）：documents H1 派生值超 500 字在 Postgres 仍会 DataError（documents 路径有 broad except 降级告警；reparse 路径会使该次扫描失败——预存行为，触发需 500+ 字 H1 的病态输入）。

## 文件变更清单（自声明——提交面夹带嫌疑 3 文件均属本变更）

- backend/app/modules/change/title_norm.py（task-01：is_fallback_display_title + TITLE_MAX_LEN）
- backend/app/modules/change/service.py（task-04：_apply_parsed 兜底回翻守卫）
- backend/app/modules/platform_sync/service.py（task-02/03：收养段加固 + 占位截断 + documents 守卫；含随本提交入库的既有工作区收养段）
- backend/app/modules/change/tests/test_title_normalization.py（task-01/03/04 用例）
- backend/app/modules/platform_sync/tests/test_change_deleted_guard.py（task-02 用例；含随本提交入库的既有收养五场景用例）

模块文档对账说明：docs/backend/modules/change.md 与 platform_sync.md 均未记载标题派生/收养行为（grep title/标题零命中），本变更不改变两文档已记载的任何接口，无需同步。
