---
author: qinyi
created_at: 2026-09-09 12:53:17
---

# 需求清单（Requirements）— 2026-09-09-sessions-visual-refresh

设计细节见 design.md；视觉基准见 prototype-sessions-visual-refresh.html（v4）。

## 功能需求

- FR-01 消息角色化（D-003@v1 / D-004@v1 / D-006@v2）：新建共享构件 `components/chat/chat-message-avatar.tsx`（agent=品牌渐变底+外光环，user=muted 底+成员名首字，**avatar 图片入参优先渲染**——群聊成员自定义头像能力保留，取数链不变）；单聊 v2 段路径（TextSegmentView，仅对话视图）、旧回退路径（turn-timeline output 气泡）、群聊消息行三处同源消费；用户气泡收窄（max-w 80%→72~80% 区间按 v4 原型）+ shadow-primary 降重（D-009@v1）。
- FR-02 氛围层（D-007@v1 / D-008@v1）：品牌色极光铺满 dashboard 应用壳底（background-attachment: fixed，浅色 ≤12%/dark ≤22% 浓度）；侧栏/会话列表列/会话面板半透明 + backdrop-blur 玻璃化；运行态氛围仅保留脉冲状态点+任务条 spinner，不做面板顶部渐变条/流光。
- FR-03 阴影/边框 token 体系（D-002@v2 / D-009@v1）：globals.css 新增 `--border-soft`、`--row-active`、`--row-active-ring`、`--shadow-glow`、`--glass`、`--glass-heavy`；**品牌色派生 token 三主题分值写满**（:root 紫系 / blue 蓝系 / dark 青系，blue 不继承紫）；`--shadow-primary` 全站降重；composer 聚焦环改 3px/10% 品牌色柔环。
- FR-04 轮次分隔胶囊（D-006@v2 / D-010@v1）：新建共享构件 `components/chat/round-divider.tsx`（细线+居中胶囊：第 N 轮 · 状态 · token · 时间）；**status 覆盖轮尾实际六态**（pending/running/interrupting/completed/failed/killed，着色映射见 design 接口定义）；仅替换对话视图轮尾小字，「全部/进度」视图状态条不动（Grill G-03）。
- FR-05 会话列表行降噪（D-009@v1）：行重排为「标题+等宽时间 / 引擎色点+管理员·N 轮」两行；选中态 `--row-active` 渐变底 + `--row-active-ring` 内描边替代 3px 硬竖条。
- FR-06 dark 主题层级（D-005@v1 / Grill G-06）：themes.ts darkTheme.color.bg → zinc-950 #09090b，globals.css dark 块 `--color-bg`/`--background` 同步；card 保持 zinc-800 #27272a（Tailwind 默认值铁律优先于原型像素）。
- FR-07 面板头降噪（D-007@v1）：元信息收敛面包屑式一行（#id · ● 活跃 · 机器 · 工作区），操作右置；面板头玻璃化。

## 非功能需求

- NFR-01 三主题一致：全部取值走 themes.ts / globals.css token，组件零硬编码 hex（D-002@v2）。
- NFR-02 行为零回归：交互回调、data-testid 锚点、SSE/数据组装不动；既有测试适配仅限类名/结构断言。
- NFR-03 性能：backdrop-blur 仅挂应用壳/列表列/面板头/面板四处，不挂滚动内容区（R-02）。
- NFR-04 P0 成果保留：ql-20260909-009 的气泡 80%/深色代码块/composer 阴影不回滚（D-001@v1）。

## 决策引用核对

D-001@v1（NFR-04）、D-002@v2（NFR-01/FR-03 blue 分值）、D-003@v1（FR-01）、D-004@v1（FR-01 群聊）、D-005@v1（FR-06）、D-006@v2（FR-01/FR-04 构件化+头像能力保留）、D-007@v1（FR-02/FR-03/FR-07）、D-008@v1（FR-02 极光挂壳+无流光条）、D-009@v1（FR-01 72%/FR-03 柔环/FR-05 ring token）、D-010@v1（FR-04 六态映射）——十条当前版本决策全部覆盖，无剩余风险项。
