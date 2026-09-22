---
author: qinyi
created_at: 2026-09-09 13:02:10
---

# Design Grill — 2026-09-09-sessions-visual-refresh

对 design.md（v4 原型确认版）的交叉审查。审查方式：逐 FR/逐 Wave 对照原型、decisions.md、现有代码（turn-timeline / turn-segment-views / group-chat-panel / globals.css / themes.ts）找结构性矛盾。

## 分类汇总

| 分类 | 数量 | 含义 |
|---|---|---|
| immediately_answered | 6 | 心里清楚但文档缺失 |
| needs_thinking | 0 | 需要用户判断 |
| unresolved | 0 | 真正设计漏洞 |

## Immediately Answered

| ID | 问题 | 答案 | 落点 |
|---|---|---|---|
| G-01 | 极光挂 dashboard layout 会波及 PPM 等管理页，白底表格页上是否违和 | 极光浓度 ≤12%（浅）/22%（dark）且偏离主内容区，管理页内容均在 bg-card 卡片上不受底纹影响；R-01 已挂实拍回归三页（首页/工作区/变更中心） | design 风险登记 R-01 + tasks 验收 |
| G-02 | TextSegmentView 包头像后，工具行/思考行（w-full 无头像）与气泡的左缘对齐关系 | 工具行/思考行加 avatar 宽度+gap 等值左缩进（32+11=43px），内容文字与气泡左缘对齐——原型 .proc 即按此缩进 | tasks Wave 3 任务卡 |
| G-03 | RoundDivider 与现有轮次尾状态行（turn 尾部「第 N 轮 · 已完成 · token」）是替换还是并存 | 对话视图轮尾替换为 RoundDivider；「全部/进度」视图的 turn-status-bar 保持不动（信息密度需求不同） | design FR-04 语义 + tasks |
| G-04 | 群聊成员消息头像：群聊是多用户，kind=user 头像要显示各成员首字而非统一「我」 | ChatMessageAvatar kind=user 接受 name 参数（取首字），群聊按 sender 名渲染；agent 成员消息 kind=agent——接口定义已含 name 字段 | 接口定义 + tasks Wave 5 |
| G-05 | --shadow-primary 降重会波及发送按钮/空门户图标/列表＋按钮等现有消费方 | 有意为之：该 token 全部消费方统一降重，观感一致（D-009 口径即"全站投影降重"）；非逐组件局部改 | design Wave 1 |
| G-06 | 原型 dark --card 用了 #1b1b1f（非 Tailwind 默认值），与 D-005「card 保持 zinc-800」矛盾 | 以 design/决策为准：落地 card=zinc-800 #27272a（Tailwind 默认），原型 #1b1b1f 是手写近似值；bg zinc-950 拉开后反差已够。themes.ts 铁律（色阶仅限 Tailwind v3 默认值）优先于原型像素级还原 | design FR-06（已写 zinc-800） |

## Unresolved Blockers

| ID | priority | 问题 | 阻塞原因 | 下一步 |
|---|---|---|---|---|
| — | — | 无 | — | — |

## 结论

无 P0/P1 结构性矛盾；6 条 immediately_answered 全部已在 design.md/tasks 拆解口径内消化（G-02/G-03 在 tasks 任务卡写明，G-06 以 design 为准）。可进入 plan。
