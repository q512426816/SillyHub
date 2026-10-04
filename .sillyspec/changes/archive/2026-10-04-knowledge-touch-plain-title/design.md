---
author: flow-machine-draft
created_at: 2026-10-04T07:59:55.043Z
---
# 设计记录（Design Record）— 2026-10-04-knowledge-touch-plain-title

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-knowledge-touch-plain-title 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
只改前端资产卡知识触达组的标题字符串与注释：归档/在途两态统一为用户语言（「知识触达（本变更参考过的知识）」，在途加「 · 实时」尾标提示记录仍在增长），原机制黑话（「注入命中 · 待复核标记反查 / 实时」）移出标题正文，数据口径说明改挂标题 span 的 title 悬停属性。同步更新组件测试断言（在途态改新文案、归档态补标题断言）并最小修正知识库 FR-auto-frontend-093 条目（其引用了旧标签文案）。选此方案：用户会话中确认的诉求即"标题说人话、机制收进悬停提示"；后端 assets.py 两路合并口径不变，不动 DTO（无需 gen:types）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-knowledge-touch-plain-title 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无后端/DTO/端点改动：ChangeAssetsRead 结构与 assets.py 聚合口径不变，无需 gen:types。对外可见变化仅两处：①前端 change-assets-card.tsx 知识触达组标题两态文案更换 + 新增 title 悬停属性（纯展示层，组件 props 签名不变）；②知识库 fr/frontend.md 的 FR-auto-frontend-093 条目标题与场景正文同步改写（元数据与 test-bindings 机器段不动）。
文件变更清单（自声明）：frontend/src/components/changes/detail/change-assets-card.tsx；frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx；.sillyspec/knowledge/fr/frontend.md；.sillyspec/changes/2026-10-04-knowledge-touch-plain-title/（本变更工件：design/requirements/tasks/proposal/visual-evidence/flow-state）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-knowledge-touch-plain-title 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯静态展示文案，不消费时序数据；列表数据仍由后端一次性聚合返回，文案不随数据到达顺序变化。
2. 并发写：不适用——组件无共享可变状态；知识库 fr/frontend.md 为单点编辑，sillyspec knowledge validate 通过。
3. 切换/生命周期：不适用——React 纯渲染层字符串替换，无状态残留；archived 布尔仍由后端判定，两态切换逻辑不变。
4. 作用域：不适用——文案硬编码于组件，不随 workspace/多实例变化，无串台面。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-knowledge-touch-plain-title 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：文案改写后与知识库 FR 条目语义漂移（FR-auto-frontend-093 引用旧标签）——已同步最小修正该条目并 validate 通过规避。试过但放弃：①把两态口径差异做成可见副标题——放弃，机制细节对普通用户是噪音，用户诉求就是"说人话"；②顺带改写空态引导文案——放弃，超范围（其行为未变，FR 语义仍准确）；③起全栈环境渲染实页截图——放弃，纯字符串替换无布局/样式变化，组件测试断言即证据面（先例 2026-09-27-assets-testfile-bracket-note 同口径）。
