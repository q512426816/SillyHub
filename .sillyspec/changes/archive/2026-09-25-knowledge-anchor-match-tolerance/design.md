---
author: flow-machine-draft
created_at: 2026-09-25T08:42:20.106Z
---
# 设计记录（Design Record）— 2026-09-25-knowledge-anchor-match-tolerance

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-anchor-match-tolerance 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
在 `parser.py` 新增纯函数 `anchor_match_key`（小写 + 只保留 `0-9a-z_` 与中文，丢 emoji/点号/短横/斜杠等全部符号）；`HitsService.stats` 聚合前用它建「归一键 → 条目锚点集合」解析表，命中锚点先精确比对（既有行为恒优先），未中且归一键唯一候选才回退到条目锚点，歧义/未中保持原锚点原样。

改两处：`backend/app/modules/knowledge/parser.py`（新常量 + 新函数）、`backend/app/modules/knowledge/hits.py`（stats 内解析闭包 + 聚合循环一行）。**展示层零变化**——条目 anchor 字符串、DTO 字段、前端都不动，只是聚合键从「命中侧原样字符串」换成「解析后的条目锚点」。

选这个落点的理由：条目锚点是本仓按当前文件标题现算的 slug，命中锚点是 CLI 写 INDEX 路由行时的原样字符串，两侧由不同规则/不同人/不同版本维护，实测三类系统性漂移（emoji 前缀、点号、短横折叠）导致逐字比较必然漏计；改 CLI 写侧属跨仓且存量 INDEX 会被 CLI 重写覆盖，改本仓 INDEX.md 会被 CLI 下一次生成覆盖，只有平台侧归一容错是自洽且可本地验证的修法。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-anchor-match-tolerance 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
函数：`parser.anchor_match_key(anchor: str) -> str`（新增导出，纯函数、无 I/O）；`HitsService.stats` 内新增 `_resolve_anchor` 局部闭包（不导出）。`parse_knowledge_entries` / `slugify_anchor` 签名与产出**不变**。

对外可见：HTTP 端点、响应 DTO（`KnowledgeStatsOut` 及子结构）、字段名、前端消费口径**零变化**——变的只是同一份数据下 `coverage.used_entries`、`dead_entries`、`usage_board[].anchor`、`entry_counts[].count` 的取值：过去被判成幽灵锚的命中归位到条目锚点，同一条目的多种漂移写法合并到同一行。

行为边界三条：① 精确命中恒优先（精确面命中结果与改动前逐字一致）；② 归一键映射到 ≥2 个条目锚点时（歧义）不认、保持原锚点；③ 归一键未中（真实内容漂移）保持原锚点原样进榜（可见性不丢）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-anchor-match-tolerance 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. **乱序/迟到到达**：解析表由「本次 stats 读到的当前知识树」一次性构建，命中行按 DB 读出后逐条解析——解析结果只依赖锚点字符串本身，与命中行的到达顺序无关。迟到行只影响既有的 first/last/窗口计算（本变更未触碰该逻辑）。
2. **并发写**：stats 全程只读（知识树读盘 + hits 读库），无任何写入面；同工作区并发 stats 各自构建各自的解析表，无共享可变状态。写入侧 `ingest_batch` 未改动，幂等语义不变。
3. **切换/生命周期**：knowledge 树在 stats 执行中途被同步改写（文件增删）时可能读到瞬态树——这是 parser 现场读盘的既有行为，本变更不放大；解析表与 entries 来自**同一次**解析结果，不存在「表-树错配」的新窗口。请求被打断即丢弃局部表，无持久化状态。
4. **作用域**：解析表只由本工作区 `spec_root`（`_spec_content_root`）下的知识树构建；命中查询带 `workspace_id` 过滤（既有 WHERE）；`anchor_match_key` 是无状态纯字符串函数。跨工作区/跨仓/多实例不串台。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-anchor-match-tolerance 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
**最大风险**：归一化过宽，把「标题真不同」的两条折叠成同键而误判命中（虚增覆盖）。缓解：回退只在归一键**唯一候选**时生效（歧义不猜，宁少认不虚增），单测同时钉正向（三类真实漂移样本必须归位）与反向（歧义对、真实内容漂移样本必须不认）；实测两仓真实数据（平台仓 28467 次命中 / CLI 仓 10829 次命中）歧义锚点 0 个。次要风险：丢符号使键变短、理论碰撞概率上升——碰撞即落入「歧义不认」分支，方向安全（只是少认，不会错认）。

**试过但放弃的方案**：
1. 改 CLI 写侧（INDEX 锚点生成规则与平台 slug 统一）——跨仓改动，且存量 INDEX 由 CLI 下次生成覆盖，平台侧仍会漏；已作为工具缺陷记入 `docs/sillyspec/knowledge-hits-anchor-drift-and-upload-stall.md` 的 T2。
2. 手改本仓 `INDEX.md` 里那 6 条漂移路由锚——会被 CLI 下一次 classify/decision-distill 重写回漂移形态，且治不了其他工作区同款漂移。
3. 模糊/前缀匹配（覆盖 `hosthost-跑` vs `hostrun` 这类**真实内容漂移**）——必然把不同小节误并（虚增覆盖），不做；该类保持未命中并在留档标注。
4. 把覆盖率分母改成「可路由条目」——属统计口径的另一层决策（会从死条目清单里隐去「有知识但没进 INDEX」的可动作信号），且需要新增 DTO 字段；本变更不夹带，留作后续。
