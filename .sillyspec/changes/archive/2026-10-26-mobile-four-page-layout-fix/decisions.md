---
author: qinyi
created_at: 2026-10-26 23:08:54
---

# 决策记录 — 2026-10-26-mobile-four-page-layout-fix

## D-005@v1 执行期裁决：task-11 header「双按钮高度收紧」收窄为 padding 微调——44px 触控下限优先

- **status**: accepted
- **type**: implementation
- **source**: agent
- **日期**: 2026-10-26（execute Wave 2 task-11 执行期）
- **歧义描述**: FR-09 写「mobile-workspace-header 双按钮高度收紧」；执行发现双 Tab 按钮已是 min-h-[44px] 触控达标线，且 task-11 卡自身约束与 task-02 密度基座（--m-row-min-h: 44px 触控下限「只升不降」）+ mobile-workspace-header.test.tsx 既有触摸热区断言三重卡死——降高度违反触控可达性约束。
- **选择**: 双 Tab 高度保持 44px 不动；收紧落为 padding 微调（tabs 行 pb-2→pb-1、标题行 py-1→py-0.5），header 总高降 ~6px。
- **理由**: 触控可达性（R-04 既有验收口径）> 密度微收益；截图中 header 不是主要痛点（FAB 遮挡才是，已由 spacer 修复）。
- **影响 task**: task-11；FR-09 的「双按钮高度收紧」以此口径视为完成（padding 收紧）。

## D-004@v1 执行期裁决：task-05 透传链收窄——TurnSegmentViews 的子代理卡 inline marquee 不透传 mobile

- **status**: accepted
- **type**: implementation
- **source**: agent
- **日期**: 2026-10-26（execute Wave 2 task-05 执行期）
- **歧义描述**: design Wave 2 第 3 条写明 turn-segment-views.tsx:1034 挂载点透传 mobile；执行发现该挂载点是子代理卡（SubagentBlockView）的 `layout="inline"` 形态跑马灯——inline 形态根容器 `w-full`（无 ml-9 溢出缺陷），透传需经 SubagentBlockViewProps → SegmentView 分发器 → 上游三层加 prop，改动面与收益不匹配（LIVE 徽标 ~30px 装饰性文本在无溢出缺陷的容器内）。
- **选择**: 透传链只覆盖有实际缺陷的 turn-timeline 侧（轮尾 TurnLiveMarquee + RoundDivider，经 TurnTimeline.variant → TurnRow.mobile → SegmentedTurnBody.mobile 布尔基元）；TurnSegmentViews 侧不透传（inline marquee 保持 desktop 形态）。
- **理由**: 非破坏性（可逆、局部、不越 allowed_paths——turn-segment-views.tsx 在清单内「少改」合法）；plan 盲区② 关注的是「误传 mobile 改 PC 悬浮面板行为」——不透传恰好消解该风险面。
- **影响 task**: task-05（收窄完成）；task-12 verify 阶段对账时以此为准。
- **复核条件**: 若真机复验发现子代理卡 LIVE 徽标在窄视口构成挤压，再立后续变更透传。

## D-001@v1 四页面移动端修复技术路线：方案 A（既有 mobile 分支机制）

- **status**: accepted
- **type**: architecture
- **source**: user
- **日期**: 2026-10-26
- **question**: 四页面（工作区选择 /m/workspaces、会话对话 /m/.../sessions/[sid]、会话列表 /m/.../sessions、变更中心 /m/.../changes）移动端显示修复采哪个技术方案？
- **answer**: 方案 A——延续 ql-20260915-009/013 两轮收敛已验证的模式：共用组件（turn-live-marquee / turn-segment-views / session-panel 输入区 / platform-sync-section 等）按需加 `mobile`/`variant` 属性走小屏分支样式，/m/ 专属页面直接收紧自身布局与密度；globals.css `[data-variant="mobile"]` 排版块按需扩展。理由：每处改动锁死在手机分支内，PC 端（dashboard 路由）desktop 路径不执行新样式，硬约束「PC 零回归」最有保障；模式成熟、测试锚定惯例（mobile 用例 + desktop 锚用例）现成，可逐页验收。
- **evidence**: brainstorm Step 4 方案对比（AskUserQuestion，2026-10-26），用户选项「方案 A：既有分支机制（推荐）」
- **硬约束**: PC 端效果不得变差（优化性影响可接受，劣化不可接受）——用户原话；验收含 PC 相关测试零回归 + desktop 锚定用例。
- **修复尺度**: 彻底优化（同轮 AskUserQuestion 用户确认）——修溢出/截断/遮挡三类硬伤 + 控件尺寸间距收紧提升单屏密度。

## D-002@v1 落选方案 B（全局响应式断点重构）— rejected

- **status**: rejected
- **type**: architecture
- **source**: user
- **question**: 同 D-001 问句
- **理由**: 方案 B——共用组件全面改造成按屏幕宽度自适应的一套样式（断点/容器查询）。
- **否决理由**: 动电脑端主战场（SessionPanel 族为 PC 核心交互面）样式，窄窗口 PC 也会触发断点样式，直接违反「PC 不能变差」硬约束；与既有两轮 mobile 分支决策（ql-20260915-009/013）路线冲突，推翻成本高、回归面不可控。
- **复潮条件**: 若未来产品决策接受 PC 窄窗口视觉随断点变化、且 SessionPanel 组件族具备完整的视觉回归测试基线时，可重评。

## D-003@v1 落选方案 C（移动端独立组件套件）— rejected

- **status**: rejected
- **type**: architecture
- **source**: user
- **question**: 同 D-001 问句
- **理由**: 方案 C——/m/ 会话页不再复用 PC 端 SessionPanel，为手机端重写一套轻量组件。
- **否决理由**: 会话面板逻辑庞大（SSE 流/消息队列/轮次状态机/子代理路由），重写工作量数倍于本轮全部修复之和；组件族双份长期维护成本；本次工期与风险不可接受。
- **复潮条件**: 若移动端会话使用量增长到值得独立演进、且有专职维护投入时，可重评。
