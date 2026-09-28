---
author: flow-machine-draft
created_at: 2026-09-28T06:45:19.285Z
---
# 设计记录（Design Record）— 2026-09-28-knowledge-gov-ux

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） --
governance-cards.tsx 单文件人话改版（数据链与动作通道零变化）：
- 文案层：kind→人话标题/正文（伪域=「知识未归位」+影响说明；inbox=「经验待归类」+明说建议交给 AI 会话；rot=「规则待复核」+同款；binding-unresolved=「引用路径失效」+一键修复）；healthy 安语与底部计数全部换人话标签（待复核/待归类/未归位/早期遗留）；卡片区标题去「CLI 命令」话术改「N 项可以整理（不影响日常使用）」。
- 交互层：伪域卡从「手填目标域字符串」改为分池行——detail（「auto-backend 73、…」）正则解析分池，已知四池（auto-sillyhub-daemon→daemon / auto-backend→backend / auto-frontend→frontend / auto-sillyspec→sillyspec）每池预填推荐去向 + [一键归位]（antd Popconfirm 二次确认，okText 中文，同页面 reject 入口先例）；unmapped 池无按钮只给人话无害说明；未知池兜底纯展示。解析失败降级整卡说明（不渲染分池）。
- 反馈层：mutation 成功/失败结果行（data-testid 不变）；daemon 离线（actions_available=false）时按钮隐藏 + 「守护进程在线」提示。
- 推荐去向依据：本机 redomain dry-run 逐池验证可行（目标域不存在则新建域文件，ID 不变）。
>

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） --
无对外接口变化：GET /knowledge/governance 与 POST /knowledge/governance/actions 均未动；后端零改动、api-types 零变化。前端组件内部：移除自由文本输入 testid（redomain-target），新增 redomain-go-<pool> / repair-paths-btn testid；governance-cards / governance-card-<kind> / governance-action-result 保留。
>

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） --
1. 乱序/迟到：detail 解析对格式容错（matchAll 逐段匹配，格式漂移只是分池行消失、整卡说明兜底），不假设池顺序；POOL_META 未命中的池走「暂无推荐去向」纯展示，不误迁。
2. 并发写：同卡多池按钮共享一个 mutation，action.isPending 全池禁用（不会并发两次 redomain）；后端/daemon 侧 redomain 幂等（ID 不变重复迁同域无副作用）。
3. 切换/生命周期：操作成功 invalidateQueries 刷新卡片；Popconfirm 未确认不触发 mutation；无持久本地态（仅 result 展示态）。
4. 作用域：redomain 作用于仓库知识文件（daemon 侧 allowed_roots containment 既有防线），页面按 workspaceId 走既有鉴权；预填 target 均为白名单字符集 [a-z0-9-]+（前端 POOL_META 常量 + 后端 422 校验双防线）。
>

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） --
最大风险：推荐去向的「粗归位」语义——auto-backend(73)/auto-frontend(72) 是混主题池，整池迁到粗域 backend/frontend 是粗粒度归位（优于伪域 fallback 但非精分）；已在按钮 Popconfirm 文案中如实说明「只调整归属分类」。放弃的方案：①在页面上做收件箱逐条归类向导/rot 复核向导——放弃，判断类操作做成半吊子表单比不做更危险，明确交给 AI 会话是更诚实的产品决策；②后端加结构化 pools 字段替代 detail 解析——放弃，后端零改动保住 thin 边界，detail 格式由 backend service _add 单点拼装且测试钉住；③unmapped 699 提供一键消音——放弃，无 CLI 动作支撑（local.yaml 手工），页面放假按钮违背「机械动作才一键」原则。
>
