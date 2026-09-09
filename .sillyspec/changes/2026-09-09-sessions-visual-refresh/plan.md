---
author: qinyi
created_at: 2026-09-09 13:45:00
plan_level: full
---

# 实现计划（Plan）— 2026-09-09-sessions-visual-refresh

依据：design.md（五 Wave 总体方案 + 接口定义 + 风险登记）、requirements.md（FR-01~07 / NFR-01~04）、decisions.md（D-001~D-010 当前版本）、prototype-sessions-visual-refresh.html（v4 视觉基准）。

## 规模分类

- estimated_files: 14（10 改 4 新）
- cross_module: false（纯 frontend 表现层）
- has_schema_change: false
- has_state_machine_change: false
- needs_parallel_execution: false（Wave 间有依赖：token → 构件 → 消费方）
- needs_human_review: true（UI 视觉验收，task-12 实拍效果图用户确认）

## Wave 划分与任务依赖

```
W1  task-01 globals.css token 三主题分值      ──┐
    task-02 themes.ts dark 底色               ──┤
W2  task-03 ChatMessageAvatar(+useAvatarSrc)  ← 01 ┐
    task-04 RoundDivider+桶导出               ← 01 ┤
W3  task-05 turn-segment-views 头像(对话视图) ← 03 │
    task-06 turn-timeline 头像+轮次胶囊        ← 03,04
    task-07 session-panel-page 面板头降噪+玻璃 ← 01
W4  task-08 session-list-panel 行降噪          ← 01
    task-09 dashboard layout 极光壳            ← 01
W5  task-10 group-chat-panel 群聊接入          ← 03
    task-11 session-input-bar 聚焦柔环         ← 01
W6  task-12 回归+实拍验收                      ← 05,06,07,08,09,10,11
```

## 任务索引

- task-01 globals.css 氛围/阴影 token 三主题分值（FR-02/03/06，D-002@v2/D-009@v1）
- task-02 themes.ts darkTheme.color.bg → zinc-950 + 测试适配（FR-06，D-005@v1）
- task-03 components/chat/chat-message-avatar.tsx + useAvatarSrc 平移 + 单测（FR-01，D-006@v2）
- task-04 components/chat/round-divider.tsx 六态 + index.ts + 单测（FR-04，D-010@v1）
- task-05 turn-segment-views.tsx 对话视图 agent 头像行 + 43px 对齐（FR-01）
- task-06 turn-timeline.tsx 用户/旧路径 agent 头像 + 对话视图轮尾 RoundDivider（FR-01/04）
- task-07 session-panel-page.tsx 面板头面包屑降噪 + 玻璃化（FR-07）
- task-08 session-list-panel.tsx 行两行化 + 引擎色点 + 选中态 token（FR-05）
- task-09 dashboard layout 极光背景 + 侧栏/列表列/面板玻璃化（FR-02，D-008@v1）
- task-10 group-chat-panel.tsx 头像接入（自定义头像保留）+ token 化（FR-01 群聊，D-006@v2）
- task-11 session-input-bar.tsx composer 聚焦 3px/10% 柔环（FR-03，D-009@v1）
- task-12 回归 + tsc/eslint + dev server 实拍（三页 × 双主题 + blue 会话页）用户验收

## 关键实现口径（防执行漂移）

- 极光只挂应用壳（layout 背景 fixed），不挂滚动内容区（R-02 性能）；
- 头像仅对话视图生效，「全部/进度」视图时间线原样式不动（Grill G-03）；
- 工具/思考行左缩进 43px（32 头像 + 11 间距）与气泡左缘对齐（Grill G-02）；
- 群聊自定义头像取数链不动，ChatMessageAvatar 仅统一渲染形态（D-006@v2）；
- dark card 保持 zinc-800 #27272a，仅 bg 改 zinc-950（G-06，Tailwind 默认值铁律）；
- 一切色值走 token，组件零硬编码 hex（NFR-01）；测试锚点 data-testid 全保留（NFR-02）。
