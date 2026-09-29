---
author: flow-machine-draft
created_at: 2026-09-29T00:49:55.976Z
---
# 设计记录（Design Record）— 2026-09-29-issue-row-grid-misalign

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-issue-row-grid-misalign 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
一行核心修复：frontend/src/components/primer/issue-row.tsx 行组件在 leading 缺席时由渲染 null 改为渲染空占位 div（aria-hidden），与同文件 IssueRowHeader 既有占位先例（:117 `{leading ? <div>{leading}</div> : <div />}`）对齐。

机理：ISSUE_ROW_GRID 四轨 [auto, auto, minmax(0,1fr), auto] 首轨为 leading 插槽（批量模式勾选框）。无占位时普通行子元素左移一格——主体列落进第 2 轨 auto（按内容 max-content 撑宽）、右列内容落进第 3 轨 minmax(0,1fr)（可缩到 0）：长描述行第 2 轨吃满可用宽、第 3 轨被压到比右列内容窄，右列 flex justify-end 布局的内容**向左溢出画出自身容器盒**（生产实测：容器盒 left 1519 而内容 step-sub-row left 1083），与描述文字互相叠压——即用户报告的 desc(basis-full truncate) × step-sub-row 重叠（sillyspec 工作区归档 unclear-req-to-brainstorm 行 Playwright 复现，包围盒交集 true）。补占位后主体落 1fr 轨（可收缩、truncate 有确定边界）、右列落 auto 轨（按内容定宽、永不左溢）。

此前三轮修复未触此根因的教训：测量一直比对右列容器盒界（1519）而其内容已左溢出盒（1083）——凡 flex/grid 容器 justify-end + overflow，判定必须量内容元素而非容器盒。

文件变更清单（自声明，收口对账面）：
- frontend/src/components/primer/issue-row.tsx（task-01：leading 空占位）
- frontend/src/components/primer/__tests__/primer-structures.test.tsx（task-02：占位回归用例）
- .sillyspec/changes/2026-09-29-issue-row-grid-misalign/*（变更产物）

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-issue-row-grid-misalign 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
IssueRow DOM 结构变化：无 leading 时第 1 个子元素由无（子元素左移错轨）变为空 `<div aria-hidden>`（四子元素落设计轨道）；IssueRowProps 签名不变。消费方两个（changes/page.tsx 不传 leading、prototype 视图属静态原型）行为变化：主体列从 auto 轨回到 1fr 轨——长描述截断于主体列边界、右列内容不再左溢。带 leading 的既有调用（若有批量模式）子元素数不变、轨道不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-issue-row-grid-misalign 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯渲染结构，无输入/事件时序。
2. 并发写：不适用——无共享可变状态。
3. 切换/生命周期：不适用——无会话/请求态；aria-hidden 空占位对可访问性零影响（无内容无焦点）。
4. 作用域：改动在 primer 组件内、全部 IssueRow 消费方同语义受益（主体回 1fr 轨）；IssueRowHeader 占位先例同款，跨工作区/页面一致。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-issue-row-grid-misalign 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：占位 div 占据首轨 auto 宽度——空 div 无内容宽≈0，轨道宽 0，视觉零位移；对带 leading 调用零影响。放弃方案：改 ISSUE_ROW_GRID 为三轨模板/条件模板——两套模板分叉后 header/row 对齐约束翻倍，占位是同文件既有先例的最小修复。
另注：三断点①②按会话自主模式跳过等待（用户已给 DOM 级证据、根因有 Playwright 复现锚定、改动一行），③归档结果照常汇报。
