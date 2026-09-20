---
author: qinyi
created_at: 2026-09-20 09:27:05
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话面板与 agent 对话、阅读 agent 长回复的人（桌面与 mobile 变体） |
| 前端开发者 | 维护会话时间线组件的开发者（类名契约的使用方） |

## 功能需求

### FR-01: agent 回复文本无框化（双路径一致）
覆盖决策：D-001@v1, D-002@v1, D-004@v1, D-005@v1

#### 场景：v2 段模型文本段（主路径）
Given 会话时间线渲染含 text 段的 turn（segments 非 undefined）
When TextSegmentView 渲染文本段
Then 容器为 `.seg-text-body`：无 border/底色/阴影/气泡内边距，铺在时间线背景上，max-width 为 min(100%, 48rem)；CopyButton 与流式光标 `.seg-caret` 挂载行为不变

#### 场景：旧数据回退路径
Given 孤儿 turn / 旧会话数据（segments undefined）且有 output 答复
When 旧路径渲染答复
Then 容器同为 `.seg-text-body` 无框样式，内容自适应宽度（不取 w-full），行尾时间戳仍尾随内容边缘；与 v2 路径视觉形态一致

#### 场景：连续多文本段
Given 一轮内多个 text 段（可能直接相邻）
When 渲染为多个 `.seg-text-body`
Then 段间由既有 space-y 间距分隔，可辨识边界；不新增分隔线/背景块装饰

### FR-02: mobile 可读性规则随类名迁移
覆盖决策：D-003@v1

Given 会话时间线以 mobile 变体渲染（data-variant="mobile"）
When agent 文本段显示
Then `.seg-text-body` 应用 font-size 14px / line-height 24px；规则不携带 max-width 覆盖（阅读限宽由 min(100%,48rem) 统一承担）

### FR-03: 用户侧气泡完全不变
覆盖决策：D-001@v1

#### 场景：用户消息气泡
Given 会话时间线渲染用户消息（turn.prompt）
When 用户气泡渲染
Then 类名 `.turn-bubble` 与品牌色右对齐气泡样式与改前一致

#### 场景：轮内引导消息三态气泡
Given 轮内 steering 引导注入的 user_msg 段（steering/delivered/ended 三态）
When 引导消息渲染
Then 三态气泡样式与类名与改前一致（不因本变更变化）

## 非功能需求
- 兼容性：无 API/schema 变更；旧数据回退路径与 v2 主路径形态一致（"回退不崩不空且行为等价"约定维持）
- 可回退：纯样式级 diff（类名与样式串替换 + 一段 CSS 规则迁移），单 commit 可整体回退
- 可测试：类名契约可被 DOM 断言（.seg-text-body 存在、无 border/bg-card 类；.turn-bubble 仅用户侧）；全仓 grep 可核对无残留旧类名

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-03 | 气泡语义划分：agent 去气泡、用户保留 |
| D-002@v1 | FR-01 | 双渲染路径同步改，不分叉 |
| D-003@v1 | FR-02 | mobile 字号/行高规则迁移到新类名 |
| D-004@v1 | FR-01 | 保留阅读限宽、不加新分隔装饰 |
| D-005@v1 | FR-01, FR-02 | 方案 B：容器语义重构（新无框正文类） |
