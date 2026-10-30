---
author: qinyi
created_at: 2026-10-30T11:55:00+08:00
scale: large
tier: self
---
# 设计记录（Design Record）— 2026-10-30-askuser-config-pending

## 目标/背景/问题描述

**目标**：让用户在会话中（含 askuser 待答期间）改配置时能**看见**改动已被记住且尚未生效（逐控件待生效高亮），且暂存不因刷新丢失。

**背景**：会话配置暂存能力已全量交付（2026-10-25-session-config-deferred-switch + 2026-10-26-config-staged-all-states）——任意状态（空闲/运行中/askuser 待答）点选四控件（供应商/模型/思考档位/档案）均仅本地暂存、零网络请求零新轮次，随下一条消息发送一并生效；askuser 答复（respondSessionPermission → daemon 同轮回喂）后 AI 无缝继续。

**问题**：①暂存完全静默（2026-10-25 D-001@v1 静默决策）——控件只显示新值，无「已记住待生效」标记，用户无法确认改动被记住，误以为问答期间不能改配置；②暂存为面板内存 state，刷新页面即丢；③「提交回答后按新配置执行」与现状「下一条消息生效」存在认知差，需要可视化弥合（答复后 AI 继续段用旧配置是技术必然——中途换模型=打断重启）。

## 决策/方案选择

关键取舍（全表见 decisions.md D-001~D-009，摘要）：

| 决策点 | 选定 | 否掉的备选 | 裁决来源 |
| --- | --- | --- | --- |
| 生效时机 | 随下一条消息（D-002/D-008） | 答复提交即无轮写入（协议扩展，2026-10-26 已弃） | 用户（知晓技术背景后选方案 A） |
| 标记形态 | brand 描边+浅底+悬停文案，无文字角标（D-001@v2） | 文字角标（用户首轮看过后去掉）；常驻汇总行 | 用户两轮裁决 |
| 持久化 | sessionStorage per-tab per-session（D-004） | localStorage（跨页共享+TTL 清理负担）；不持久化 | 用户方案 A |
| 范围 | 仅 page 模式四控件（D-003） | dialog 弹窗面板补配置条 | 用户 |
| 坏数据/失效值 | 静默丢弃（D-005）；不前置校验（D-006） | 弹错/前置校验 | agent 判断 |

## 非目标（Non-goals）

见 proposal.md「不在范围内（Non-Goals）」六条：不改 askuser 答复链路、不做无轮切换通道、不补 dialog 弹窗配置条、不做 localStorage 跨页共享、不做常驻汇总行/文字角标、不前置校验恢复值有效性。

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

暂存能力已全量交付但完全静默（2026-10-25 D-001 静默决策），本变更补**感知层**与**短期持久化**，两处改动：

① `frontend/src/components/sessions/session-config-bar.tsx`：ctrlButton（及思考档位同款胶囊）增加 pending 视觉态——该控件存在暂存字段（staged prop 对应键 !== undefined）时胶囊类名切高亮态 `ring-1 ring-brand-400 bg-brand-50`（brand 语义阶随主题换肤，无文字角标——用户裁决 2026-10-30），title 改「已记住，将随下一条消息发送时生效」。判定纯派生（staged prop 已传入组件，2026-10-26 已有 displayProviderId 同款「暂存优先」模式——四控件显示值均已暂存优先派生：displayProviderId/stagedModel/stagedThinkingLevel/stagedProfileId，源码 592/652/786/833 行），不新增 state。**title 优先级（Grill B-001/D-009）**：禁用态（ended/离线/canSwitch=false）文案优先于 pending 文案——禁用原因对用户是更关键的信息（如暂存挂着时会话 ended：高亮仍在但不可点，title 显示禁用原因）。

② `frontend/src/components/daemon/session-panel/session-panel-page.tsx`：stagedConfig 变更实时写 sessionStorage（key `sh:config-staged:<sessionId>`，值 `{ config, labels }`——labels 即 stagedLabelRef 内容，档案/供应商显示名，刷新后 buildStagedChangeLine 与组件 label 回显不丢名）；恢复点=sessionId 切换 effect（现有 1110-1113 清空 effect 改为「清内存态 → 读当前会话条目恢复」，SSR 守卫 typeof window）；清除点=settleStagedAfterSend（发送成功，含思考档位失败保留的部分清除语义）与会话切换；JSON 解析失败/结构异常 catch 静默丢弃并清坏条目。

选此方案原因：生效语义维持「随下一条消息」（用户裁决方案 A，纯前端）——askuser 答复链路（respondSessionPermission → daemon 同轮回喂）零改动即天然自洽（D-002/D-008）：问答期间暂存亮高亮 → 提交回答 AI 无缝继续 → 下一条消息生效高亮消失。sessionStorage 生命周期与短期暂存语义对齐（刷新保留/关标签页自清/per-tab 隔离零写竞争）。

## 接口契约

生命周期契约：无/N/A——本变更纯前端视觉层与浏览器本地暂存持久化，无 session/daemon/lifecycle 事件收发与状态机变化（正文提及 session 仅为 sessionStorage API 与会话 id 隔离键）。

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `SessionConfigBar` props 签名**零变化**（staged/onStagedSwitch 既有）；行为变化：staged 字段存在的控件渲染高亮态类名 + 悬停 title 文案（仅视觉层）。
- `session-panel-page.tsx` 内部：stagedConfig 持久化 effect 新增；sessionId 切换 effect 从「纯清空」改「清空+按会话恢复」；settleStagedAfterSend 增加清除 sessionStorage 动作。均为组件内部逻辑，无导出签名变化。
- sessionStorage 新增私有 key 族 `sh:config-staged:<sessionId>`（值为 `{ config: SessionConfigStaged, labels: Partial<Record<string, string>> }` JSON）——浏览器本地暂存，非 API 契约。
- **无**后端/daemon/API/协议/SSE 变化；**无** askuser 答复链路（respondSessionPermission / PERMISSION_RESPONSE）改动；原型管线注册表（frontend/scripts/prototype-build.mjs VIEWS）新增一条（随变更提交）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立——高亮是 staged prop 的纯派生渲染（React 单向数据流，无乱序面）；持久化写入由 useEffect([stagedConfig, sessionId]) 驱动，同一渲染批次收敛，最后写者胜即最新暂存态。SSE 迟到导致的 running 抖动不影响（高亮不依赖 running）。刷新恢复发生在挂载/sessionId 切换单一时机，与实时写入无交叠（恢复后首次写入覆盖恢复值，语义正确）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

sessionStorage per-tab：同会话多标签页各自独立副本（天然隔离，无写竞争——这正是选 sessionStorage 而非 localStorage 的主因，方案对比见 step4）。同标签页内 stagedConfig 唯一写方是面板（既有约束），持久化 effect 是唯一写 sessionStorage 的执行体。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

会话切换：现有 effect 清内存暂存 + 本设计同步清/换持久化条目（读新会话条目），不串台。发送失败：暂存保留（既有），持久化条目保留（effect 未触发清除）——重试语义一致。思考档位 POST 失败保留档位暂存：部分清除时持久化同步写残留态（labels+thinking_level），刷新后残留一致。刷新：挂载恢复。SSR：typeof window 守卫，服务端渲染零访问。

4. 作用域：跨工作区/跨工作区/多实例时数据会不会串台？

key 按会话 id 隔离，跨会话不读不写；跨标签页 per-tab 隔离；跨浏览器/设备天然隔离（sessionStorage 不随账号漫游）。坏数据（手工改 sessionStorage）静默丢弃兜底。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：**「随下一条消息生效」与用户直觉「提交回答即按新配置执行」的语义差**——答复后 AI 继续跑的当前段仍是旧配置（daemon 同轮回喂，中途换模型=打断重启，用户明确不要）。缓解：高亮+悬停文案明示「将随下一条消息发送时生效」，用户已在该语义下裁决方案 A（知晓技术背景后选择）；原型态四（askuser 场景）明示该时序。次要风险：sessionStorage 恢复的暂存值可能已失效（供应商/档案被删）——沿用既有「发送失败保留重试」语义不前置校验（D-004），失败路径用户可感知可改选。

放弃的方案：①答复提交即无轮写入会话配置（方案 B）——需扩 permission 协议+daemon 无轮切换通道，2026-10-26 评估改动面大已放弃，本次用户复裁维持放弃；②localStorage 跨标签页共享——暂存短期语义下属过度设计，需 TTL 清理防残留；③常驻汇总说明行——用户裁决「只逐控件标记」；④「待生效」文字角标——用户裁决去掉（高亮本体即标记）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | ctrlButton/思考档位胶囊 pending 高亮态（ring+bg-brand-50+title 文案），staged 字段级派生 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | stagedConfig sessionStorage 持久化（写/恢复/清除）+ labels 同存 |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | 高亮渲染/消失/悬停文案断言；存量调用面无高亮回归 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx（面板暂存既有测试面，持久化断言按此扩展；实现时若发现其它触及面同步登记） | 持久化写入/恢复/清除/坏数据丢弃断言 |
| 已交付 | frontend/src/components/prototype/session-config-pending-view.tsx | 真码原型视图源码（四态，用户已批准；随变更提交） |
| 已交付 | frontend/scripts/prototype-build.mjs | VIEWS 注册表新增 session-config-pending-view 条目 |
| 已交付 | .sillyspec/changes/2026-10-30-askuser-config-pending/prototype-config-pending.html | 原型编译产物登记（prototype:build 产物拷贝） |
