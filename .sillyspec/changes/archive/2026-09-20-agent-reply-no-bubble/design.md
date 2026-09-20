---
author: qinyi
created_at: 2026-09-20 17:43:29
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-20-agent-reply-no-bubble

## 背景

会话时间线（session panel 对话视图）目前是"一半有框、一半没框"的混合形态：用户消息是品牌色气泡（frontend/src/components/daemon/turn-timeline.tsx:550），agent 回复文本是卡片气泡（frontend/src/components/daemon/turn-segment-views.tsx:509 `.seg-text-bubble`），而思考行、工具行、系统事件、文件卡、子代理文本段全部无框。

agent 回复本质是长文档（markdown、代码块、表格），装进气泡持续产生摩擦：ql-20260909-009 已因"气泡顶满成文档块"把限宽 86%→80%（frontend/src/components/daemon/turn-segment-views.tsx:507 注释）；mobile 又放宽到 94%（frontend/src/app/globals.css:825）——气泡感名存实亡，只剩一圈边框。子代理文本段更早已用 CSS 覆盖透明化去气泡（frontend/src/components/daemon/turn-segment-views.tsx:107）。主流 AI 会话产品（Claude/ChatGPT/Gemini/DeepSeek）均为"用户消息气泡 + AI 回复无框铺底"形态。本变更把最后一步走完。

## 设计目标

1. agent 回复文本在两条渲染路径（v2 段模型 + 旧数据回退）统一去气泡：无边框、无底色、无阴影、无气泡内边距，铺在时间线背景上，保留 48rem 阅读限宽
2. 用户消息气泡（含轮内引导消息三态气泡）视觉完全不变
3. mobile 端 agent 文本可读性规则（字号 14px / 行高 24px）随类名迁移，不丢失
4. 类名语义干净：去气泡后 bubble 类名只存在于用户侧，不留"名不副实"注释

## 非目标

- 不改轮结构：不动逐段头像、whoLine、每轮 agent 名字头、内容列全宽（方案 C 内容，YAGNI）
- 不动思考行/工具行/系统事件药丸/文件卡/AskUser 卡等本就无框的元素
- 不新增分隔线、背景块等新视觉元素来"补偿"边界感（D-004）
- 不改后端/接口/schema/数据模型
- 不建新的设计 token 体系（48rem 是本处局部取值，非全局规范）

## 拆分判断

单一视觉改造、单模块（frontend 会话时间线）、任务量小（3 源文件 + 2 测试文件），不拆分、不走批量模式。

## 总体方案

方案 B（容器语义重构，D-005）。单一 Wave，三个任务按依赖排序：

1. **task-01 v2 主路径去气泡**：`TextSegmentView`（frontend/src/components/daemon/turn-segment-views.tsx:503-520）容器类 `seg-text-bubble` → 新类 `seg-text-body`，样式由 `group relative max-w-[80%] self-start rounded-2xl rounded-tl-md border border-border/60 bg-card px-4 py-2.5 shadow-sm` 改为 `group relative w-full max-w-[min(100%,48rem)] self-start`（无框无内边距）；`CopyButton` 与 `.seg-caret` 流式光标挂载点随容器平移，行为不变；同文件 `SEGMENT_ANIMATION_CSS` 中删除 `.seg-subagent-body .seg-text-bubble` 透明化规则（frontend/src/components/daemon/turn-segment-views.tsx:107-113）——子代理文本段换用 `seg-text-body` 后天然无框，覆盖变冗余。已知微差（接受）：子代理块内文本失去原覆盖里的 `padding:6px 0` 竖向呼吸（由子代理块内部 space-y 间距承接）与 `max-width:100%`（48rem 上限在子代理面板窄列内不构成约束）。
2. **task-02 旧路径同步**：frontend/src/components/daemon/turn-timeline.tsx:696 旧数据回退答复气泡容器换 `seg-text-body` 无框样式。⚠️ Grill 探针修正：旧路径容器在 `flex items-end gap-1.5` 行内与行尾时间戳并排（v2 路径无行内时间戳，答复时间在段后「开始·结束·历时」行，frontend/src/components/daemon/turn-timeline.tsx:1467-1484），故旧路径容器不可 `w-full`（会把时间戳推到右缘、改变现有节奏）——取 `group relative max-w-[min(100%,48rem)]` 内容自适应宽度，时间戳仍尾随内容边缘，行为与现状等价；`.turn-bubble` 自此仅存于用户气泡（frontend/src/components/daemon/turn-timeline.tsx:550），mobile 放大规则定位语义随之收敛，注释同步改写。
3. **task-03 globals.css 迁移 + 测试**：mobile 块（frontend/src/app/globals.css:818-826）`.seg-text-bubble` 规则迁至 `.seg-text-body`，**只保留 font-size 14px / line-height 24px，不带 max-width 覆盖**（Grill 探针修正：`max-width:94%→100%` 的覆盖会以更高优先级压掉桌面端 `min(100%,48rem)` 阅读限宽，mobile 上限宽语义交给 48rem 上限与列宽本身）；块注释改写；测试同步见文件清单。

形态对照见原型 prototype-agent-reply-no-bubble.html（改后/现状一键切换 + 三主题）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | TextSegmentView 容器类改 seg-text-body 无框样式（48rem 阅读限宽）；SEGMENT_ANIMATION_CSS 删 .seg-subagent-body .seg-text-bubble 透明化规则；相关注释同步 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 旧路径答复气泡（:696）换 seg-text-body 同款容器；.turn-bubble 注释收敛为用户气泡语义 |
| 修改 | frontend/src/app/globals.css | mobile 块 .seg-text-bubble 规则迁移至 .seg-text-body（仅字号 14px/行高 24px，不带 max-width 覆盖——防止压掉 48rem 阅读限宽）；块注释改写 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx | :411 `.seg-text-bubble` 断言改 `.seg-text-body` |
| 修改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | TextSegmentView 组注释措辞更新（气泡→无框正文）；新增无框形态断言（容器存在 .seg-text-body 且无 border/bg-card 类） |

纯展示层改动，无对外字段/接口/DTO/事件 payload 变更，无 producer→consumer 数据流。

## 接口定义

无新方法签名/数据结构。新增的唯一"契约"是类名语义约定：

- `.seg-text-body`：agent 文本正文容器（v2 段模型 TextSegmentView + turn-timeline 旧路径共用）——无 border / 无底色 / 无阴影 / 无内边距，`max-width: min(100%, 48rem)`，容器上挂 `group relative` 供 CopyButton hover 浮出定位
- `.turn-bubble`：自本变更起仅指用户消息气泡（右对齐、bg-primary）；mobile 规则只作用用户侧
- `.seg-subagent-body`：子代理块容器类名不变，仅删除其下对旧文本气泡的透明化覆盖

## 生命周期契约表

不适用 lifecycle contract——生命周期契约：无/N/A。本变更是纯前端展示层样式调整，不触碰 session/lease/agent_run 等任何生命周期事件、状态流转或 daemon 协议（文件路径中的 daemon/ 仅为前端目录名）。

## 数据模型

无 schema/表结构变更。

## 兼容策略（brownfield 必填）

- 旧数据回退路径（segments undefined 的孤儿 turn/旧会话）与 v2 主路径去气泡后形态一致，维持"回退不崩不空且行为等价"既有约定（D-002）
- 无功能开关需求：样式即时生效，无"未配置新功能"中间态
- 不改变的接口：后端 API、DTO、OpenAPI、事件协议、`pnpm gen:types` 产物均不动
- 用户气泡、引导消息三态气泡（steering/delivered/ended）、AskUser 卡、文件卡的渲染路径与类名不动

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 类名替换遗漏：仍有选择器/测试/样式引用旧 `.seg-text-bubble` 气泡语义 | P1 | 全仓 grep `seg-text-bubble\|turn-bubble\|seg-subagent-body` 清单化核对（已预查：源 3 处 + 测试 4 处，见文件清单）；verify 阶段复跑同款 grep 兜底 |
| R-02 | 去气泡后连续多文本段（无工具/思考行间隔）视觉边界感弱 | P2 | 依赖既有 space-y 段间距（frontend/src/components/daemon/turn-timeline.tsx:502）；真实使用中纯连续文本段少见（D-004），实测不足再迭代，不为低频场景加装饰 |
| R-03 | 48rem 阅读限宽在超宽面板/桌面全屏下观感待验证 | P2 | 取值对齐主流（Claude ≈48rem）；不理想时一行样式值调整即可，不阻塞 |
| R-04 | 无框正文与时间线背景同色，极长回复滚动时归属辨识度下降 | P2 | 头像列 + 段间距维持归属线索；用户气泡右对齐形成强对比（探索结论）；实测有 complaints 再评估轻量左侧竖线等方案（届时走新 quick） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-01 / FR-03；总体方案 task-01+02；接口定义类名契约 | 已覆盖 |
| D-002@v1 | FR-01；总体方案 task-02；兼容策略第 1 条 | 已覆盖 |
| D-003@v1 | FR-02；总体方案 task-03 | 已覆盖 |
| D-004@v1 | FR-01；非目标第 3 条；风险 R-02/R-04 | 已覆盖 |
| D-005@v1 | 总体方案（方案 B 全章）；文件变更清单 | 已覆盖 |

无未解决决策。备注：D-005 与 step5 设计确认为用户离席时按预置推荐默认采纳（AskUserQuestion 未作答，进度库已留痕），用户可 reopen step4/step5 改选——若推翻方案 B，本设计文档与决策追踪整体重做。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large——4 文件源改动+2 测试、双路径同步，超 small 门槛（≤2 文件），且用户明确走完整流程）
- [x] 引用所有当前版本 D-xxx@v1（D-001~D-005 全部出现在决策追踪）
- [x] 生命周期关键词命中（文件路径含 daemon/session）→ 已写紧邻豁免短语「生命周期契约：无/N/A」
- [x] UI 原型分级核对：组件级视觉变化（页面骨架不变），按"拿不准默认生成"已产出 prototype-agent-reply-no-bubble.html（含现状/改后对比 + 三主题）
- [x] 文件清单路径全部为已存在文件的仓根相对路径（无新建源文件，无 NEW: 前缀需求）
- [ ] ⚠️ 自审存疑：48rem 取值与连续文本段边界感为视觉判断项，已列 R-03/R-02，不阻塞设计、留待实测
