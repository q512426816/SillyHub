---
author: flow-machine-draft
created_at: 2026-10-02T01:19:25.817Z
---
# 设计记录（Design Record）— 2026-10-02-title-norm-thin-h1-family

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-02-title-norm-thin-h1-family 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
只改后端 `backend/app/modules/change/title_norm.py` 的 `_TEMPLATE_TYPE_WORDS` 词表：补收 thin（flow-draft）模板 H1 家族四个类型词——`设计记录`（插在 `设计` 前）、`任务注册表`（插在 `任务注册` 前）、`决策记录`、`验证回执`。根因：CLI 轻量变更的四件套文档 H1 是「类型词（英文）— <变更名>」形态，documents 推送按最深阶段文档（tasks.md）重派生 title 时靠该词表识别模板并回退 change_key 去日期前缀；词表只有 `任务注册`（尾字「表」挡住后缀匹配），模板 H1 被误判为自定义语义标题，反把 CLI 收养的好标题覆盖。纯词表补收即闭环（归一化/兜底判定/回翻守卫三写路径同源消费同一正则），不动任何写路径逻辑。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-02-title-norm-thin-h1-family 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
函数/端点签名零变化：`normalize_display_title` / `is_fallback_display_title` / `TEMPLATE_H1_RE` 对外形状不变，仅正则可匹配集合扩大（新增 thin 模板四词命中）。对外可见行为变化仅一处——thin 变更经 documents 推送/reparse 派生的 ux_changes.title 从「任务注册表（Tasks）— <变更名>」等 raw 模板文案变为 change_key 去日期前缀语义名（或保留 CLI 收养标题不被回翻）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-02-title-norm-thin-h1-family 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到到达：成立。词表是纯静态正则，documents 迟到推送/reparse 乱序到达时同一 H1 恒判模板，幂等；存量被污染的 title 行（存过 raw 模板文案）在修复后被 `is_fallback_display_title` 判为兜底形态，下一次任意推送/reparse 即自愈刷新，不依赖到达顺序。
2. 并发写：无新增面。三写路径（CLI 收养/documents 推送/reparse）本就共用该判定做回翻守卫，词表补收只让「模板 H1」回到正确的兜底侧，不改锁与事务语义。
3. 切换/生命周期：安全。变更中途收口/重开不涉及——正则无状态； archived 变更不再推送，其历史行保持原值直到有新推送（可接受，见风险节）。
4. 作用域：词表按 sillyspec CLI 模板家族校准，是进程内常量，不落库不跨仓；多实例同版本同行为。若 CLI 未来再新增模板 H1 类型词，需同步补词表（已知维护耦合，注释已标注来源 flow-draft.js）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-02-title-norm-thin-h1-family 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：误伤面——若某作者自定义标题恰为「设计记录」「任务注册表」等裸类型词（无冒号/无后续内容），会被当模板回退语义名。该风险与既有词表条目（「设计」「任务」等更短的词）同级且更小（新词更长更具体），既有测试锚定冒号自定义标题保留不受影响。遗留：已归档变更不再有 documents 推送，其存量污染 title 行不会自动刷新（新变更与活跃变更自愈）；如需清洗可后续做一次性 reparse/修数，不在本变更范围。放弃的方案：在 documents 推送侧按文件名（tasks.md/design.md）硬判模板而不看 H1 内容——放弃理由：会废掉「自定义 H1 覆盖收养标题」的改名通道（tasks.md 写自定义 H1 是合法改名路径，有既有测试锚定）。
