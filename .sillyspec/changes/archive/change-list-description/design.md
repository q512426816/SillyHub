---
author: flow-machine-draft
created_at: 2026-09-28T05:26:25.187Z
---
# 设计记录（Design Record）— change-list-description

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change change-list-description 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
数据已在场、缺的是搬运与展示：proposal.md `## 动机` 段两种真实形态（thin 机器稿=「任务原话转写：<--input 原文>」、完整流程=agent 书写散文）都含可读描述，平台只取了 H1 当 title（模板 H1 归一化后回退 key 派生名）。
方案：title_norm.py 新增共享纯函数 `extract_description(text)`（动机段首个非空段落→剥 HTML 注释→剥「任务原话转写：」前缀→在首个「成功标准」处截断→段内列表行剥除→空白折叠→截 500），两条写路径（change parser reparse / platform_sync documents 推送）同源消费写入 `changes.description` 新列（String(500) 可空，alembic 迁移），ChangeSummary/ChangeRead 透出，列表搜索 ILIKE 加命中该列，前端变更中心（桌面+移动）行内在标题下渲染单行截断描述（悬浮全文，无描述零占位）。
不选 CLI 侧改模板 H1：只覆盖未来 thin 变更、存量与完整流程变更不受益，且自动起语义标题易碎；平台侧一次覆盖两类变更与存量（reparse/推送即回填）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change change-list-description 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
- `title_norm.extract_description(text: str | None) -> str | None`（新共享纯函数，与 extract_h1/normalize_display_title 同居）。
- `changes` 表新增列 `description VARCHAR(500) NULL`（迁移 20260928140000，down_revision=20260926234000）。
- `ParsedChange.description: str | None`（新字段）；`ChangeService._build_change/_apply_parsed` 持久化。
- `platform_sync._sync_change_title_from_documents` 同步重派生 description（proposal.md 推送内容）。
- DTO：`ChangeRead.description: str | None = None`、`ChangeSummary.description: str | None = None`（optional，brownfield 安全）——OpenAPI 变更，前端 `pnpm gen:types` 再生成 api-types.ts。
- `GET /changes` 搜索：ILIKE 范围由 change_key/title 扩为 change_key/title/description（查询参数签名不变）。
- 前端：变更中心列表行（桌面 changes/page.tsx + 移动 m/.../changes/page.tsx）标题块新增描述行；搜索框 placeholder 提及描述。无其它端点/命令变更。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change change-list-description 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到到达：documents 推送只带部分四件套（无 proposal.md）→ extract_description(None) 返回 None，行保持现值不被清空？否——本设计推送路径仅在 proposal.md 在场时重派生，缺席不动现值（与 title 的 best-effort 语义一致：迟到推送只补不改不删）；reparse 时 proposal.md 缺失 → parsed.description=None，_apply_parsed 会写 None（清空）——接受：文件是权威源，文件没了描述随没，与 title 同口径。
2. 并发写：reparse 与 documents 推送并发同 key——两路径各在事务内 upsert，撞 ux_changes_workspace_key 唯一约束回滚静默（既有 _ensure_change_row race-lost 范式）；description 与 title 同源同函数，不存在互翻窗口。
3. 切换/生命周期：中断的 reparse/推送事务整体回滚，description 与该事务其它写同生死；已删行（location='deleted'）不被推送路径重派生（GAP-1 防复活守卫复用，title 同款）。
4. 作用域：description 按 (workspace_id, change_key) 行存储，查询恒带 workspace 过滤，不跨工作区串台；提取函数纯函数无全局态。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change change-list-description 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：提取规则对动机段书写形态的覆盖面——动机段可能只有列表、可能含「成功标准」字样在散文中、可能空段。对策：规则保守（无动机段/剥后为空 → None，前端零占位），500 字符截断防长文破版，纯函数加一组形态回归测试（thin 机器稿/完整流程散文/列表首段/无动机段/空前缀）。
放弃的方案：① CLI 侧给 thin proposal 起语义 H1——只惠及未来 thin，存量与完整流程不受益，且机器自动起标题质量不可控；② 前端行内直接拉 proposal 文档渲染——列表页多一轮文档请求、且 search 仍搜不到，不解决「找」的本痛点。
