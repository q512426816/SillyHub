---
author: flow-machine-draft
created_at: 2026-09-28T13:38:16.467Z
---
# 设计记录（Design Record）— 2026-09-28-unmapped-batch-redomain

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-unmapped-batch-redomain 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） --
纯知识数据迁移（零代码改动）：fr/unmapped.md 698 条 FR 索引按来源变更分批归位真域。
- 映射级联：①变更归档文档路径提及统计（backend/frontend/sillyhub-daemon 前缀计数，主占比≥0.6 直判，66 变更）②变更名关键词规则（28）③条目文本关键词投票（5）④人工复核 FAIL 1 个 + 抽查纠偏 5 个（codex-interactive-session→daemon、sessions-workspace-selector×2→frontend、unify-runtime-session-dialog→frontend、interactive-idle-timeout-fix→daemon，依据条目标题原文）。
- 搬迁脚本：## FR- 分段 → 按变更分组追加到 fr/{backend,frontend,daemon}.md（ID 不变，同 redomain 工具语义）→ 删 unmapped.md + 清 INDEX 行。判定依据全量留档 mapping-analysis.json（含 via 级别与路径计数）。
- 守恒验证：698=390+207+101；三域文件条目数复核；knowledge validate ok/errors[]；digest 伪域归零。
>

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-unmapped-batch-redomain 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） --
无接口/代码变化。知识文件变化：fr/unmapped.md 删除（698 条迁出）；fr/backend.md +390（共468）、fr/frontend.md +207（共309）、fr/daemon.md +101（共184）；INDEX.md 删 unmapped 路由行。条目 ID 保持 FR-unmapped-NNN 前缀不变（redomain 同款身份保持语义）。
>

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-unmapped-batch-redomain 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） --
1. 乱序/迟到：迁移是一次性脚本全量重写，无并发窗口；幂等性——unmapped.md 已删，重跑脚本无源可迁（天然防重）。
2. 并发写：执行期间无其他会话写 fr/（工作区独占窗口）；git 提交原子落库。
3. 切换/生命周期：无运行时消费方——fr 文件仅任务注入/治理 digest 读，下轮自然读新态。
4. 作用域：仅动本仓知识文件；粗域归位（backend/frontend/daemon 三桶）与页面一键归位口径一致，条目全文随迁可被内容搜索命中，跨域错置风险已由四级判定+人工纠偏压到最低。
>

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-unmapped-batch-redomain 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） --
最大风险：粗域错置（name/text 级判定的变更可能有个别条目实际属另一端）——条目全文随迁、搜索按内容命中，错置代价是「在相邻模块也能搜到」而非丢失；判定依据全量留档可回溯可再迁。放弃的方案：①逐条 698 次语义判定——成本翻数倍、收益边际（粗桶清理已达成可查找目标）；②给 redomain 工具补 --by-change 参数后用工具迁——正确长期路径（已留档 docs/sillyspec 缺陷2）但等工具排期，本次数据清理不该被工具改进阻塞。
>
