---
author: qinyi
created_at: 2026-09-07 23:37:55
scale: large
---

# 设计文档（Design）— 2026-09-08-session-list-liveness-dot

## 背景

上一变更 2026-09-07-agent-liveness-states（已归档）把 agent 会话活性状态（working/blocked/idle/ended/unknown 五态）全链路落库并展示在「工作台状态总览卡」与「agent 日志面板徽章」两处，但**会话列表行没有加状态小灯**——归档 verify-result NOTES 明确登记为已知缺口（①列表行尾小灯+悬停详情卡、②idle 未读小红点），原因是当时需要 SessionsPortal 与 platform_agent_logs 的 liveness 联表管道 + session-list-panel 大组件手术，单独留下。本变更补齐这两处 UI 缺口，纯前端、无后端改动、无类型生成需要。

## 设计目标

- 会话树/会话列表每行行尾出现关联日志的活性状态小灯（~18px，复用既有 `LivenessDot` 视觉），状态随 30s 轮询刷新。
- 悬停小灯弹出详情小卡（复用 `livenessTitle`：状态全名/静默时长/关联/证据摘要/推导时间）。
- `working/blocked → idle` 新转移的行加未读小红点；点开该会话后消失（localStorage 记已读）。
- 列表布局零变化：不新增列、不动归档分组/机器小节等既有逻辑；双主题（blue/ai-native）语义阶正常。

## 非目标

- 不改后端任何代码（联表在前端侧完成，`GET /api/agent-logs` 既有响应已含全部所需字段）。
- 不跑 `pnpm gen:types`（无后端 schema 变动；用户明确「无后端改动则无需 gen:types」）。
- 不往 liveness 状态枚举加「未读」（用户明确约束；未读是纯 UI 本地状态）。
- 不做跨设备已读同步（localStorage 是浏览器本地；换设备/清存储后红点按最新转移重新出现，属可接受语义）。
- 不改工作台总览卡与日志面板徽章（两处既有展示不动）。
- 不做群聊行（GroupChatRow）的小灯（无 agent_session_id 关联语义，后续按需）。

## 拆分判断

单一功能（列表行小灯+未读点）、单一模块（frontend 会话列表域）、4 个文件——不拆分、不批量。用户明确要求走完整流程（brainstorm → plan → execute → verify），故不走 quick。

## 总体方案

### 1. 取数：新 hook `use-session-liveness.ts`

- `useQuery({ queryKey: ["agent-liveness-overview", "all"], queryFn: () => listWorkspaceAgentLogs(100), refetchInterval: 30_000 })`——**缓存槽固定 `"all"`**（D-001@v2，Grill CC-01 修订）：API 本就不按 workspace 过滤（鉴权 scope 全量），槽位带 wsId 只会造成缓存分裂；固定槽让本 hook 的所有挂载点（悬浮会话宿主 FloatingSessionHost 全 dashboard 常驻、会话门户多页）共享同一份缓存与 30s 轮询。工作台总览卡（wsId 槽）与本 hook 各自独立互不干扰，跨路由切换时 react-query gcTime 内仍复用。口径：≤40s 可见性（tailer 10s 推送 + 30s 轮询，对齐归档结论）。
- hook 返回 `Map<string, AgentLogListItem>`（key=`agent_session_id`，仅含有值条目）+ 原始 entries。map 构建按 API 返回序（last_seen_at DESC）**首个胜出**——同 agent_session_id 多行时取最新行（Grill CC-13）。
- limit=100 对齐总览卡口径（用户规格建议值）。
- **转移检测状态机**（D-001@v2，Grill BL-01 修订）：hook 每轮数据处理时对每个会话执行——读 localStorage `sillyhub:liveness-state:${sessionId}` 得 prevState；若 `prevState ∈ {working, blocked}` 且 `current == idle` → 写 `sillyhub:liveness-unread:${sessionId}` = Date.now()；随后写 state 键 = current。首见（无 prevState）不触发；localStorage 读写 try/catch 降级（不可用时转移检测停摆=不亮红点，不崩）。

### 2. 行尾小灯 + 悬停卡（session-list-panel.tsx）

- `SessionListPanel` 调用 hook 一次建 map + 未读集合，经既有 props 链（WorkspaceTreeList → WorkspaceGroupNode → SessionRow）传入 `liveness?: AgentLogListItem` 与 `livenessUnread?: boolean`（map 命中 `session.id` 才有值；未命中不传 → 不渲染灯）。
- `SessionRow` 第一行行尾（相对时间之后、hover 操作按钮之前）渲染 **antd Popover（trigger="hover"）包裹的 18px 小灯**：Popover 默认 portal 渲染到 body——SessionRow 根节点 `overflow-hidden`（:2640）会裁剪 absolute 卡片，portal 是唯一不破行布局的落法（Grill BL-02）；trigger 区内为 `LivenessDot({ state })`（复用五态视觉，不重写）。
- 悬停卡内容为**组合渲染**（非 livenessTitle 单行字符串，Grill CC-04）：状态全名（LIVENESS_META[state].label + 五态色点）+ 静默时长（last_event_at 相对时间）+ 证据摘要（state_evidence 截断展示）+ 推导时间（state_derived_at）。「关联」行不设——AgentLogListItem 无 change_key/quick_id 数据源。
- 不新增列、不改行布局：小灯是行内 flex 尾部追加节点（flex none，18px）。

### 3. idle 未读小红点（D-003@v1 / D-001@v2）

- 显示：`sillyhub:liveness-unread:${sessionId}` 标记存在（由 hook 状态机在 working/blocked→idle 转移时写入，见 §1）。
- 清除：**`selected` 置真时**（SessionRow 对 `selected` prop 的 useEffect，false→true 边沿）清除该标记——覆盖点击选中 / Enter / 深链 `?session=` 三路入口（深链经 sessions-portal useEffect 直置 selectedSessionId，不走 onSelect，Grill BL-03）；批量模式勾选（onToggleCheck）不触发清除（语义正确）。
- 渲染：小灯右上角 7px 红点（`bg-destructive`，带背景色描边），`aria-label="有新的空闲状态未读"`。

### 4. 测试

- 既有 `session-list-panel.test.tsx` 补用例：有命中渲染小灯与悬停卡内容、无命中无灯、idle 未读红点出现（prevState=working→current=idle）/selected 置真后消失/首见不亮、布局断言（不新增列）。**测试文件补 `vi.mock("@/lib/agent-logs")`**（既有 mock 集没有它，防 jsdom 真实 fetch 噪声，Grill CC-12）。
- 新 `use-session-liveness.test.ts`：map 构建（DESC 首个胜出）、queryKey 固定 "all" 槽、转移检测状态机（working→idle 亮 / 首见不亮 / blocked→idle 亮）、已读清除。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | frontend/src/hooks/use-session-liveness.ts | liveness 取数 + 转移检测 hook（producer=GET /api/agent-logs 既有响应 → react-query 缓存（固定 "all" 槽，多挂载共享）→ consumer=SessionListPanel 建 map + 未读集合） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | SessionListPanel 调 hook 建 map + props 链透传；SessionRow 行尾小灯+悬停卡+未读红点；onSelect 写已读 |
| 修改 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | 补小灯/悬停卡/未读点用例（复用既有 mock 结构） |
| 新增 | frontend/src/hooks/__tests__/use-session-liveness.test.ts | hook 单测 |

数据流（纯消费，无新增对外字段）：`AgentLogListItem.state/state_derived_at/state_evidence/last_event_at/agent_session_id`（api-types 既有生成类型，经 lib/agent-logs.ts listWorkspaceAgentLogs 反序列化）→ use-session-liveness map → SessionRow 小灯/悬停卡/未读判定 → localStorage 已读时间戳（本地 UI 状态，不上行）。

## 接口定义

```typescript
// frontend/src/hooks/use-session-liveness.ts
export function useSessionLiveness(): {
  bySessionId: Map<string, AgentLogListItem>; // key=agent_session_id（仅含有值条目，DESC 首个胜出）
  entries: AgentLogListItem[];
  isLoading: boolean;
};

// 转移检测存储（模块内私有 helper，不导出存储实现）
function readLastState(sessionId: string): string | null;   // localStorage state 键，异常返回 null
function writeLastState(sessionId: string, state: string): void;
function isUnread(sessionId: string): boolean;              // unread 标记键存在性
function clearUnread(sessionId: string): void;               // selected 置真时由组件调用（导出给 SessionRow useEffect 用）
// localStorage 键：`sillyhub:liveness-state:${sessionId}` / `sillyhub:liveness-unread:${sessionId}`
```

组件侧：`SessionRowProps` 增可选 `liveness?: AgentLogListItem` 与 `livenessUnread?: boolean`；`SessionListPanel` 内部消费 hook，不改对外 props 契约（门户挂载点零改动）。

## 生命周期契约表

不涉及生命周期契约（纯前端展示层：消费既有 liveness 派生状态做渲染与本地已读标记，不发起/不改变任何 session/lease/agent_run 生命周期事件；「working/blocked → idle」是只读的显示判定，非状态机变更）。

## 数据模型

无 schema 变更（纯前端；localStorage 键值仅本地 UI 状态）。

## 兼容策略（brownfield 必填）

- 无关联日志的会话（map 未命中）不渲染小灯——行为与现状完全一致。
- hook 查询失败/加载中：map 为空 → 全部行无灯，列表其余功能不受影响（fail-open）。
- localStorage 不可用：try/catch 降级，红点语义退化为会话内刷新周期显示，无崩溃。
- 不改任何 API、表结构、既有组件对外 props。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | session-list-panel 是 ~2800 行大组件，行尾插节点可能碰坏归档分组/机器小节/批量模式逻辑 | P0 | 只在 SessionRow 第一行 flex 尾部追加 flex-none 节点，不触碰分组/小节归约；改后跑全量既有 session-list-panel 测试（用户指定的硬验收） |
| R-02 | limit=100 可能截断长列表会话的 liveness 覆盖 | P2 | 对齐总览卡口径（用户规格建议值）；超出 100 条的会话无灯（与总览卡同样盲区），后续需要时升 limit 或分页——本变更不扩 |
| R-03 | 客户端转移检测跨 30s 轮询窗口：working→idle→working 快速震荡可能漏检一次转移 | P2 | 漏检只导致该次不亮红点（少提示不误提示）；提高轮询频率代价大于收益，接受 |
| R-04 | node_modules 半坏产生假 tsc 报错（已知坑） | P2 | 动手前 `pnpm exec tsc --version` 验康，坏则 `pnpm install --force`（本次已修复过一轮） |
| R-05 | 与变更 2026-09-07-session-pin-rename-scheduled-send 同文件（session-list-panel.tsx），**单方依赖声明**：对方设计未记载互认（Grill CC-06 勘正） | P1 | 串行执行：变更 1（hover 按钮区+标题位）先落地，本变更在其后基线上加行尾小灯（时间与按钮之间）；两改动插点不同区，git 冲突概率低；若变更 1 返工触及行尾需重估本变更基线 |
| R-06 | antd Popover 每行一个实例的渲染开销（长列表 500 行） | P2 | Popover 懒挂载（hover 才渲染 content），trigger 区仅 18px LivenessDot；实测若卡顿再降级为仅 hover 时挂载（Popover 本身懒渲染，预期无问题） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v2（客户端转移检测状态机 + 固定 "all" 缓存槽；supersedes D-001@v1） | §总体方案 1/3、§接口定义；FR-01/FR-03 | 已覆盖 |
| D-002@v1（展示硬约束继承 D-004 + Popover portal 悬停卡） | §设计目标、§总体方案 2、§风险登记 R-01/R-06；FR-02 | 已覆盖 |
| D-003@v1（未读转移语义继承，归档草案 D-006 落地） | §总体方案 3；FR-03 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/生命周期豁免/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large——用户明确要求完整流程）
- [x] 引用所有当前版本 D-xxx@vN（D-001@v2、D-002@v1、D-003@v1 入决策追踪表；D-001@v1 已 superseded）
- [x] 生命周期关键词出现（session）→ 已写紧邻豁免短语「不涉及生命周期契约」
- [x] UI 原型已生成（prototype-session-list-liveness-dot.html，双主题；未读判定说明已按 D-001@v2 修订为转移状态机）
- [x] Grill 三项阻塞已修复：BL-01（D-001@v2 客户端转移检测替代心跳戳比较）、BL-02（antd Popover portal 悬停卡替代 absolute）、BL-03（selected 置真清红点覆盖深链）；CC-01/04/06/11/12/13 一并修订
