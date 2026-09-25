---
author: flow-machine-draft
created_at: 2026-09-25T09:06:46.577Z
---
# 设计记录（Design Record）— 2026-09-25-scan-docs-stats-caliber

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-scan-docs-stats-caliber 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
在 `scan_docs/service.py` 落两处口径修正：① 模块层实有分子改用新 helper `_is_module_doc()`
判定（排除 `_module-map.yaml` 与 `*.changelog.md`），替换原来的 `endswith('.md')` 组合条件；
② stats 的文档查询多取一列 `source_mtime`，四处时间消费面（陈旧/新鲜/趋势/最近榜）统一改用新
helper `_effective_mtime(source_mtime, last_modified_at)`（source_mtime 优先、缺失回落），
并把 `MODULE_DOC_EXCLUDE_SUFFIXES`/`MODULE_MAP_FILENAME` 提为模块常量。

选这个落点的理由：分子虚高是纯判定式过宽（变更日志与模块卡成对存在，本不该算模块文档）；
时间口径错位是「读错列」——写入侧 spec_workspace 同步分支已把源文件时间落进 `source_mtime`
（新增行甚至只落该列、`last_modified_at` 为 None），而镜像 mtime 会被同步重写，只有源时间
才代表文件真实新旧。两个 helper 都是纯函数、单点使用，四处各写一遍的漂移风险被消掉。


## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-scan-docs-stats-caliber 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
改动文件：`backend/app/modules/scan_docs/service.py`
- 新增模块常量 `MODULE_DOC_EXCLUDE_SUFFIXES = ('.changelog.md',)`、`MODULE_MAP_FILENAME = '_module-map.yaml'`
- 新增纯函数 `_is_module_doc(raw_path: str) -> bool`、`_effective_mtime(source_mtime, last_modified_at) -> datetime | None`
- `ScanDocsService.stats`：SELECT 增 `ScanDocument.source_mtime` 列；模块层计数改 `_is_module_doc`；
  四处时间消费面（stale_docs / freshness / coverage.trend / recent_board）改吃有效时间

对外可见：HTTP 端点、`ScanDocsStatsOut` DTO 结构、字段名、前端消费口径**零变化**；
变的是同一份数据下的数值：`coverage.module_have` 不再把 `*.changelog.md` 计入（不再出现
have > expected）、`stale_docs`/`freshness`/`coverage.trend`/`recent_board` 按源文件时间判定。
`_module-map.yaml` 的登记数解析路径与 `_registered_module_counts` 行为不变（该函数按
`.endswith('_module-map.yaml')` 独立过滤，常量值与判定语义一致）。


## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-scan-docs-stats-caliber 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. **乱序/迟到到达**：stats 是单请求内一次 SELECT + 内存聚合，无事件流；`_effective_mtime` 只做两列取一与 tz 归一，与行到达顺序无关。
2. **并发写**：stats 全程只读（无写入、无缓存）；`reparse`/同步写入侧未改动，其写 `last_modified_at`/`source_mtime` 的既有语义不变——同工作区并发 stats 与 reparse 的最坏情形是读到写入中间态（既有行为，本变更不放大：两列各自独立取值，不会出现跨列错配的新窗口）。
3. **切换/生命周期**：无状态、无持久化中间产物；请求中断即丢弃局部聚合结果。`source_mtime` 为空的存量行按设计回落 `last_modified_at`（与修正前一致），不需要数据迁移或回填。
4. **作用域**：文档行按 `workspace_id` 过滤（既有 WHERE）；helper 是纯函数；`_is_module_doc` 只看路径尾段，跨工作区/跨布局（`.sillyspec/docs/...` 与 `docs/...` 双前缀）均按同一规则判定，不串台。


## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-scan-docs-stats-caliber 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
**最大风险**：`source_mtime` 在存量数据上可能为空（早期同步路径/本地 reparse 创建的行），若修改为「只认 source_mtime」会让这些行集体判陈旧（陈旧清单暴涨）。缓解：`_effective_mtime` 设计成 source_mtime 优先、**缺失回落 last_modified_at**，缺失行行为与修正前逐字一致；单测含「两列皆空 → 仍判陈旧（未知时间）」的对照行。

**次生风险**：模块层实有分子变小（排除变更日志）会让某些工作区的模块覆盖率**下降**（例如 40/36 → 36/36），看起来像「指标退步」——这是把虚高纠正为真实值，需在汇报里说明口径变化。

**试过但放弃的方案**：
1. 在 `_registered_module_counts` 里反向把变更日志也算进 expected（即把分母一起虚增到 40）——把 bug 变成口径，且登记表里没有 changelog 条目，语义错。
2. 改 `reparse` 让镜像文件的 mtime 等于源 mtime（写入侧 up-utime）——影响所有读 mtime 的消费面（含 change 卡片），面太大且与本次「读对列」的修法重叠；留作后续。
3. 只改陈旧判定不改趋势/最近榜——四处口径不一致会让页面自相矛盾（同一文件「新鲜」却不在最近榜），必须四处同改。

## 文件变更清单

- backend/app/modules/scan_docs/service.py
- backend/app/modules/scan_docs/tests/test_stats.py

（前者：模块层判定 `_is_module_doc`（排除 `_module-map.yaml` 与 `*.changelog.md`）+ 有效时间
`_effective_mtime`（source_mtime 优先、缺失回落 last_modified_at）与四处消费面接线；
后者：两条口径修正的单测（changelog 排除 / 有效时间三行对照）+ `_doc` 增 `source_mtime` 参数。）
