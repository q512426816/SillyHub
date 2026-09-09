---
author: qinyi
created_at: 2026-09-09 12:49:59
scale: large
---

# 设计文档（Design）— 2026-09-09-sessions-visual-refresh

## 背景

会话页（/sessions 三入口门户 + 群聊）功能密度高，但视觉是"灰盒套灰盒"的管理后台语言：气泡顶满无层级、边框硬、无氛围、深色主题底/卡反差小。用户三连反馈：「不够高级、视觉效果太差」→「还是没有高级感」→「玻璃拟态没看出来、流光条丑」。P0 止血已落地（ql-20260909-009：气泡收窄 80%、深色代码块、composer 阴影），本变更做完整焕新，目标观感对齐现代 AI 聊天产品（ChatGPT/Claude/Cursor 级别），三主题一致。

设计基准：变更目录下 `prototype-sessions-visual-refresh.html`（v4，用户已确认），四轮迭代的取舍全部沉淀在 decisions.md（D-001~D-010 当前版本）。

## 设计目标

- FR-01 消息角色化：agent 消息左侧挂共享渐变光环头像构件（`components/chat/` ChatMessageAvatar），单聊 v2 段路径（TextSegmentView，**仅对话视图**）/旧回退路径（turn-timeline）/群聊（GroupChatPanel）三处同源消费；**群聊成员已上传的自定义头像图片能力保留**——ChatMessageAvatar 增 `avatar` 入参优先渲染图片，群聊自定义头像取数链（成员表 avatar 字段→带 token 取 blob）不变（审查修正，不丢已上线功能）；用户消息右对齐品牌气泡收窄至 72~80% 区间并降重投影。
- FR-02 氛围层：品牌色极光铺满应用壳底（dashboard layout，background-attachment: fixed），侧栏/会话列表列/会话面板半透明 + backdrop-blur 玻璃化（D-008 玻璃可读性修正）；运行态氛围仅保留脉冲状态点 + 任务条 spinner，**不做**任何形式面板顶部渐变条/流光（D-008）。
- FR-03 阴影/边框体系：多层弥散阴影替代硬边框；新增共享 token `--border-soft`、`--row-active`/`--row-active-ring`、`--shadow-glow`、`--glass`/`--glass-heavy`（globals.css 三主题双套取值）；composer 聚焦环 3px/10% 品牌色柔环（D-009，替换现 ring-4 ring-brand-100）。
- FR-04 轮次分隔胶囊：共享 RoundDivider 构件（细线+居中胶囊：第 N 轮 · 状态 · token · 时间），替换会话面板角落弱小字。
- FR-05 列表行降噪：行结构重排为「标题+等宽时间 / 引擎色点+管理员·N 轮」两行；选中态 `--row-active` 渐变底 + `--row-active-ring` 内描边（替代 3px 硬竖条）。
- FR-06 dark 主题层级：themes.ts darkTheme `bg` zinc-900 #18181b → zinc-950 #09090b（card 保持 zinc-800），globals.css dark 块 `--color-bg`/`--background` 同步；取值限 Tailwind v3 默认值（D-005）。
- FR-07 面板头降噪：元信息收敛为面包屑式一行（#id · ● 活跃 · 机器 · 工作区），操作区右置；面板头/顶栏玻璃化（backdrop-blur）。

## 非目标

- 不改任何交互逻辑、数据流、API、SSE、状态机——纯表现层变更。
- 不做面板顶部渐变条/流光动画（D-008 用户明确否决）。
- 不动移动端 /m/ 页面；不动 blue 主题底色（仅共享 token 增益自然生效）。
- 不重构群聊时间线逻辑（GroupTimelineRow 归并/分页不动，仅接入头像与视觉 token）。
- P0 已落地内容（气泡 80%/深色代码块/composer 阴影）不返工（D-001）。

## 拆分判断

单变更承载：全部改动同属"会话页视觉"一个主题，共享同一批 token 与构件，拆开会造成 token 与消费方跨变更依赖。

## 总体方案

**Wave 1 — token 层**（一切取值单一源）：
globals.css 新增共享 token：`--border-soft`、`--row-active`、`--row-active-ring`、`--shadow-glow`、`--glass`、`--glass-heavy`、`--aurora-1/2/4`；dark 主题 `--color-bg`/`--background` 改 zinc-950 等值；`--shadow-primary` 三主题降重（D-009 口径）。**三主题分值（审查修正）**：品牌色派生 token（--aurora-*/--row-active(-ring)/--shadow-glow/--shadow-primary）按既有 --shadow-primary 三主题分值惯例（globals.css:107/192/281）写满 :root（ai-native 紫系）+ [data-theme="blue"]（蓝系）+ [data-theme="dark"]（青系）三块——blue 不继承紫色极光（D-002@v2）。themes.ts darkTheme.color.bg 同步 #09090b（themes.test.ts 若断言谈值随改）。

**Wave 2 — 共享聊天构件**（方案 B，D-006）：
新增 `frontend/src/components/chat/`：`chat-message-avatar.tsx`（kind: agent=品牌渐变底+外光环+Bot/✦，user=muted 底+首字；size 可选）、`round-divider.tsx`（居中胶囊+两侧细线）、`index.ts` 桶导出 + 各自单测。

**Wave 3 — 单聊面板接入**：
turn-segment-views TextSegmentView 外包头像行（agent 侧）；turn-timeline 用户气泡接 ChatMessageAvatar(kind=user) 替换现手写头像 span、旧路径 agent 气泡同挂头像；轮次尾接 RoundDivider；session-panel-page 面板头元信息收敛面包屑 + 玻璃化。

**Wave 4 — 列表与应用壳**：
session-list-panel 行两行化 + 引擎色点 + 选中态 token 化；dashboard layout 壳挂极光背景；侧栏/列表列/面板玻璃化。

**Wave 5 — 群聊接入 + composer**：
group-chat-panel 消息行接 ChatMessageAvatar + token 化选中/hover；session-input-bar 聚焦环 3px/10% 柔化（D-009）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:frontend/src/components/chat/chat-message-avatar.tsx | 共享消息头像（agent 渐变光环/user muted 首字） |
| 新增 | NEW:frontend/src/components/chat/use-avatar-src.ts | useAvatarSrc 平移自 group-member-avatar.tsx（blob 解析单份，D-006@v2） |
| 新增 | NEW:frontend/src/components/chat/round-divider.tsx | 轮次分隔胶囊构件 |
| 新增 | NEW:frontend/src/components/chat/index.ts | 桶导出 |
| 新增 | NEW:frontend/src/components/chat/__tests__/chat-message-avatar.test.tsx | 头像构件单测（task-03） |
| 新增 | NEW:frontend/src/components/chat/__tests__/round-divider.test.tsx | 轮次胶囊单测（task-04） |
| 修改 | frontend/src/app/globals.css | 新增 --border-soft/--row-active(-ring)/--shadow-glow/--glass(-heavy)/--aurora-* 三主题 token；dark --color-bg/--background→zinc-950；--shadow-primary 降重 |
| 修改 | frontend/src/styles/themes.ts | darkTheme.color.bg #18181b→#09090b（zinc-950，Tailwind 默认值） |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | TextSegmentView 接 ChatMessageAvatar |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 用户气泡/旧路径 agent 气泡接头像构件；轮次尾 RoundDivider |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 面板头面包屑降噪 + 玻璃化 |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | 列表行两行化 + 引擎色点 + 选中态 token |
| 修改 | frontend/src/components/group-chat/group-chat-panel.tsx | 群聊消息行接头像构件 + token 化 |
| 修改 | frontend/src/components/group-chat/group-member-avatar.tsx | useAvatarSrc 平移到 components/chat/ 后改 import（逻辑单份，D-006@v2） |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | PANEL_HEADER_CLS_* 玻璃化（面板头类常量所在，plan 审查补） |
| 修改 | frontend/src/components/app-shell.tsx | 侧栏玻璃化（plan 审查补：侧栏实体在此非 layout） |
| 修改 | frontend/src/components/top-bar.tsx | 顶栏玻璃化（plan 审查补） |
| 修改 | frontend/src/components/daemon/session-input-bar.tsx | 聚焦环 3px/10% 柔化 |
| 修改 | frontend/src/app/(dashboard)/layout.tsx | 应用壳挂极光背景（fixed） |
| 修改 | 上述组件既有测试 | 适配类名/结构断言（行为不变） |

## 接口定义

```tsx
// chat-message-avatar.tsx
export interface ChatMessageAvatarProps {
  kind: "agent" | "user";
  /** user 侧显示名（取首字回退）；agent 侧忽略 */
  name?: string;
  /** 自定义头像图片 URL（群聊成员已上传头像，GroupMemberAvatar 既有能力）；
      非空时优先于首字回退渲染图片——不丢已上线功能（审查 G-04 修正） */
  avatar?: string | null;
  /** 像素尺寸，默认 32（消息行）；28 供紧凑场景 */
  size?: 28 | 32;
  title?: string;
}

// round-divider.tsx
// status 对齐轮尾 TurnUiStatus 实际六态（审查修正：原三态漏 pending/interrupting/killed）
export type RoundDividerStatus =
  | "pending" | "running" | "interrupting"
  | "completed" | "failed" | "killed";

export interface RoundDividerProps {
  /** 主标签，如「第 2 轮」 */
  label: string;
  /** 轮次状态六态；着色映射：completed=success 绿 / failed+killed=error 红 /
      running=info 青 / pending+interrupting=neutral 灰 */
  status?: RoundDividerStatus;
  /** 右侧 meta（token/时间等自由文本，等宽数字） */
  meta?: string;
}
```

两构件均为纯展示组件，无自身状态；**例外（复审残留修正）**：`avatar` 为文件中心 URL（/api/file/{id}）时需带 token 取 blob——直接 `<img src>` 会 401。`useAvatarSrc` 解析 hook 从 `group-member-avatar.tsx` 平移到 `components/chat/`（构件内消费：文件中心 URL → fetchFileBlob → objectURL；http 外链直用；空/非法 → null 回首字），group-member-avatar.tsx 改为从共享位置 import（逻辑单份，不拷贝）。producer→consumer：session-panel/group-chat 直接消费 JSX，无跨进程数据流。

**视图作用域（审查修正）**：TextSegmentView 的头像外包仅在「对话」视图生效——「全部/进度」视图保持 border-l-2 时间线容器原样式不动（G-03 口径）；实现上由 SegmentView 消费侧（SegmentedTurnBody）按 viewMode 传入或包裹，TextSegmentView 自身不感知视图。

## 生命周期契约表

生命周期契约：无/N/A（纯前端表现层变更，不涉及 session/lease/agent_run/daemon 状态流转、心跳、claim 任一）。

## 数据模型

无 schema 变更；无 API 变更（`pnpm gen:types` 无需跑）。

## 兼容策略（brownfield 必填）

- 行为零变化：所有交互回调、数据组装、SSE 订阅、测试锚点 data-testid 全保留；仅类名/包裹结构/新增展示组件。
- blue 主题不串色（D-002@v2 口径）：新增品牌色派生 token（--aurora-*/--row-active(-ring)/--shadow-glow/--shadow-primary）三主题分值写满（:root 紫系 / blue 蓝系 / dark 青系）；主题中性 token（--glass/--border-soft 等透明度类）可 :root 初值 + dark 覆盖；themes.ts 仅改 dark.bg 一个键。
- 既有测试断言类名（如 max-w-[86%]/bg-muted/60）若存在随改动适配，不断言行为的不动；group-chat 100 用例（57+43）与 session 面板用例全量回归。
- 玻璃/极光为纯 CSS 背景，不支持 backdrop-filter 的旧浏览器静默降级为半透明底（不读不清但不破版）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | dark 底色 zinc-900→950 全站生效，其他页面观感偏移 | P1 | 取值仍 Tailwind 默认；dev server 实拍首页/工作区/变更中心三页回归；用户验收兜底 |
| R-02 | 大面积 backdrop-blur 低端机掉帧 | P2 | blur 半径 ≤18px、仅壳/列表列/面板头/面板四处；不挂滚动内容区 |
| R-03 | 玻璃底上 antd 组件（下拉/弹层）可读性 | P2 | antd 浮层走自身 token（不透明底）不受影响；面板内 antd Button 无底色依赖 |
| R-04 | 群聊接入丢失已上线能力：成员自定义头像图片（GroupMemberAvatar 带 token 取 blob）/成员分色被统一图标顶替 | P0 | ChatMessageAvatar 增 avatar 入参优先渲染图片（取数链不变）；群聊 agent 成员保留首字/分色区分、渐变光环仅作外圈氛围；群聊 100 用例（57+43）回归 + 自定义头像用例新增 |
| R-07 | blue 主题继承 :root 紫色极光/光晕 token（:root=ai-native）观感串色 | P1 | 品牌色派生 token 三主题分值写满（D-002@v2），blue 块给蓝系取值；blue 主题实拍纳入验收 |
| R-05 | turn-timeline 双路径（v2 段/旧回退）头像遗漏其一；TextSegmentView 双视图共用导致「全部/进度」视图也被加头像 | P2 | 头像仅对话视图生效（消费侧按 viewMode 控制）；两路径均改 + 各自测试用例核对 |
| R-06 | 极光在低色域/投影仪偏色 | P3 | 浓度 ≤22%（dark）/12%（浅），偏离主内容区 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 非目标（P0 不返工）+ 总体方案 Wave 划分 | 已覆盖 |
| D-002@v2 | FR-03/Wave 1 token 单一源 + 三主题分值写满（blue 蓝系） | 已覆盖 |
| D-003@v1 | FR-01 + Wave 2/3/5 头像构件 | 已覆盖 |
| D-004@v1 | FR-01/FR-05 + Wave 5 群聊接入 | 已覆盖 |
| D-005@v1 | FR-06 + Wave 1 dark 底色 | 已覆盖 |
| D-006@v2 | 总体方案 Wave 2 + 接口定义（avatar 入参保留自定义头像能力） | 已覆盖 |
| D-007@v1 | FR-02/FR-03 氛围与阴影体系 | 已覆盖 |
| D-008@v1 | FR-02 极光挂应用壳 + 非目标（无流光条） | 已覆盖 |
| D-009@v1 | FR-01（72%）/FR-03（柔环）/FR-05（ring token） | 已覆盖 |
| D-010@v1 | FR-04 + 接口定义（RoundDivider 六态映射） | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001@v1~D-010@v1（含 v2 修订，决策追踪表逐行覆盖点）
- [x] 生命周期契约：无/N/A（豁免短语紧邻章节标题）
- [x] UI 原型：prototype-sessions-visual-refresh.html（v4 用户确认版）在变更目录
- [x] 无 ⚠️ 自审存疑项
