---
author: qinyi
created_at: 2026-09-20 09:27:05
generated_by: sillyspec-fourpiece-init
change: 2026-09-20-agent-reply-no-bubble
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: agent 回复去气泡、用户消息保留气泡
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 会话时间线里气泡语义怎么划——agent 回复是否保留卡片气泡？
- answer: 用户确认（2026-09-20 explore 会话 + AskUserQuestion 选择直接立项）：agent 回复文本去掉气泡（边框/底色/阴影/内边距，内容铺在时间线背景上）；用户消息（含轮内引导消息三态气泡）保留品牌色右对齐气泡不动。依据：主流 AI 会话同款形态（Claude/ChatGPT/Gemini/DeepSeek），且项目已半途演进——子代理文本段已透明化去气泡、agent 气泡曾因"顶满成文档块"收窄 86%→80%、mobile 限宽放宽至 94%。
- normalized_requirement: v2 段模型文本段（TextSegmentView）与旧路径回退答复气泡均不得渲染边框/底色/阴影容器；用户气泡渲染不变。
- impacts: [FR-01, task-01, task-02, verify-01]
- 模块域: frontend
- evidence: frontend/src/components/daemon/turn-segment-views.tsx:509（TextSegmentView .seg-text-bubble）；frontend/src/components/daemon/turn-segment-views.tsx:107（子代理透明化先例）；frontend/src/components/daemon/turn-timeline.tsx:550（用户气泡，不动）；frontend/src/components/daemon/turn-timeline.tsx:696（旧路径答复气泡）；frontend/src/components/daemon/turn-segment-views.tsx:507（ql-20260909-009 收窄注释）

## D-002@v1: 双渲染路径同步改，不做新旧形态分叉
- type: compatibility
- priority: P1
- status: accepted
- source: code
- question: 只改 v2 段模型主路径，还是旧数据回退路径也同步？
- answer: 同步改。旧路径（segments undefined 的孤儿 turn/旧数据）与 v2 路径若形态不一致，同一会话里新旧消息长相分叉，违背"回退不崩不空且行为等价"的既有约定（turn-timeline.tsx:671 注释）。代价仅是多改一处类名。
- normalized_requirement: turn-timeline.tsx 旧路径答复气泡与 turn-segment-views.tsx TextSegmentView 在去气泡后视觉形态一致（同限宽、同对齐、同内边距语义）。
- impacts: [FR-01, task-02, verify-01]
- 模块域: frontend
- evidence: frontend/src/components/daemon/turn-timeline.tsx:668-696（双路径分支注释与旧路径气泡）

## D-003@v1: mobile 字号/限宽规则随类名迁移
- type: risk
- priority: P1
- status: accepted
- source: code
- question: globals.css 的 [data-variant="mobile"] .turn-bubble/.seg-text-bubble 字号规则在去气泡后怎么办？
- answer: 迁移而非删除。mobile 规则（font-size 14px / line-height 24px / max-width 94%）对 agent 文本可读性仍必要，改挂在去气泡后的新容器类名上；用户气泡的 .turn-bubble 规则保留不动。注意 .turn-bubble 同时命中用户气泡与旧路径答复气泡，旧路径去气泡后该类名仅剩用户气泡语义，mobile 规则自然只作用用户侧。
- normalized_requirement: mobile 变体下 agent 文本字号 14px / 行高 24px 规则不丢失；desktop/mobile 双形态均验收。
- impacts: [FR-02, task-03, verify-02]
- 模块域: frontend
- evidence: frontend/src/app/globals.css:818-826（mobile .turn-bubble/.seg-text-bubble 规则及注释）

## D-004@v1: 去气泡后的限宽与边界感策略
- type: premise
- priority: P2
- status: accepted
- source: user
- question: agent 文本去气泡后是否全宽铺满？多文本段之间怎么维持边界感？
- answer: 不全宽无限铺满：保留阅读限宽（去掉气泡后从 80% 放宽，具体取值 design 阶段定，对齐主流"有最大阅读宽度"做法）；段边界靠既有 space-y 段间距 + 左侧头像列对齐维持，不新增分隔线等新元素（YAGNI）。多文本段直接相邻场景少（通常被工具/思考行隔开），不足以为其加装饰。
- normalized_requirement: agent 文本段有明确最大阅读宽度；连续文本段之间有可辨识间距；不新增分隔线/背景块等新视觉元素。
- impacts: [FR-01, task-01, verify-01]
- 模块域: frontend
- evidence: explore 会话结论（2026-09-20）；frontend/src/components/daemon/turn-timeline.tsx:502（space-y-2.5 段间距）

## D-005@v1: 实现方案选 B（容器语义重构）
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: agent 去气泡的实现路径——A 原地去样式 / B 容器语义重构 / C 整套对齐主流重构？
- answer: 方案 B。⚠️ 采纳方式如实记录：AskUserQuestion 会话内用户未作答（离席），按预置推荐默认继续，非用户亲选——用户可 `sillyspec run brainstorm --reopen --from-step 4` 改选，改选 C 时本决策 superseded。理由要点：新建无框正文类（seg-text-body 语义名）承载 agent 文本，bubble 类名只留用户侧，避免"名不副实"；顺带删子代理透明化补丁（.seg-subagent-body .seg-text-bubble 覆盖，去气泡后天然冗余）+ 迁移 mobile 规则；方案 A 的共享类 .turn-bubble 拆样式是埋坑（用户气泡与旧路径答复共用），方案 C 超出本次气泡诉求（YAGNI）。
- normalized_requirement: agent 文本统一用新无框容器类渲染（v2 段模型 + 旧路径同款）；.turn-bubble 类名去气泡后仅存于用户气泡；.seg-subagent-body 透明化覆盖删除；mobile 规则挂新类名。
- impacts: [FR-01, FR-02, task-01, task-02, task-03, verify-01, verify-02]
- 模块域: frontend
- evidence: 方案选择轮（brainstorm step4，2026-09-20）；frontend/src/components/daemon/turn-segment-views.tsx:107-113（子代理透明化补丁，将删除）；frontend/src/app/globals.css:821-826（mobile 规则，将迁移）
- 故障面: 类名替换遗漏（测试/样式选择器仍引用旧类）——靠全仓 grep .seg-text-bubble/.turn-bubble 清单化核对兜底
- 退役判据: 若后续整体对齐主流形态（方案 C 复潮），正文容器类可沿用，仅结构层重排
