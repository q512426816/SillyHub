---
author: qinyi
created_at: 2026-08-26 05:20:00
scale: small
---

# 设计文档（Design）— 分身子会话门户折叠分组（P3）

## 1. 背景

P1（分身行→子会话面板入口）与 P2（递归开闸）落地后，分身子会话成为一等
会话，但会话门户（sessions 列表）中子会话与普通会话平铺混排——派一个团队
就多出 N 行，列表噪音大且无归属表达。P3 补门户分组与开流审计（路线图
最后一项）。

用户决策（持续授权默认记录）：方案 A 折叠分组（子会话折叠在父行下，保留
直达入口）。

## 2. 设计目标

1. 门户列表中子会话默认折叠为父行附属组，展开可看可点。
2. 父行有「团队」视觉标识，子行缩进表达归属。
3. 按需开流审计结论落档（无代码改动的显式确认）。

## 3. 非目标（Non-Goals）

- 不做跨页树形导航/筛选器（折叠组够用，YAGNI）。
- 不改子会话详情面板（P1 浮层已就绪）。
- 不做层级超过一层的树形展开（孙层折叠计数 sub_workers_count 已在团队
  任务块表达，门户层只按直接父折叠）。

## 4. 总体方案

### 4.A 后端（2 字段自动映射）

`daemon/schema.py` 的 `AgentSessionRead` 加：
- `parent_session_id: uuid.UUID | None = None`
- `tree_depth: int = 0`

`from_attributes` 直接映射 ORM 列（P1/P2 已落列），零查询改动、零行为变化；
`pnpm gen:types` 同步 api-types.ts + openapi.json（规则 21）。

### 4.B 前端（折叠组）

`session-list-panel.tsx`（sessions 门户列表）：
- 列表项分流：`parent_session_id` 非空的行不进主列表，按 parent 聚合为
  附属组；父行（会话本身在列表时）尾部渲染「+N 分身」折叠切换（tool_report
  合并小节同款交互模式与样式 token）；父行不在当前页时子会话组挂到
  「团队分身」独立小节（孤儿组，防丢失）。
- 子行缩进 + 「分身」徽标（violet 固定身份色，与团队任务块同口径）；
  点击子行直达既有会话打开链路。
- 无子会话的列表逐字节不变（纯增量分支）。

### 4.C 按需开流审计（结论，无代码）

- team-task-block 的 WorkerSessionOverlay 为 mount 时才建立 SSE（卸载即断）
  ——天然按需；
- 门户列表不自动开流（仅信号流 /sessions/events 单条）；
- 最坏并发：主控面板流 1 + 浮层流 1 = 2 ≤ HTTP/1.1 同域 6 上限；
- P1 设计时担心的「主控+多子会话同时开流」场景因浮层单实例设计不存在。
结论：无需代码改动，审计记录归档。

## 5. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/schema.py | AgentSessionRead 加 parent_session_id/tree_depth（from_attributes 自动映射） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | 子会话折叠组（父行附属+孤儿小节+子行缩进徽标） |
| 修改 | frontend/src/lib/daemon.ts | SessionSummary 手写类型补两字段（类型债清偿惯例） |
| 生成 | backend/openapi.json + frontend/src/lib/api-types.ts | pnpm gen:types（规则 21） |

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 存量无 parent 字段响应 | 字段 nullable 缺省，旧客户端零感知 |
| 分页边界（父在前页子在后页） | 孤儿组小节兜底，不丢行 |
| 主题合规 | 复用 tool_report 小节样式 token + violet 固定身份色 |

生命周期契约：不适用 lifecycle contract（纯列表展示层，无状态机/事件）。
