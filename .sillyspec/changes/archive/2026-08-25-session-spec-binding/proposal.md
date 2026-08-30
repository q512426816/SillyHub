---
author: qinyi
created_at: 2026-08-25 22:38:40
change: 2026-08-25-session-spec-binding
---

# 提案书（Proposal）

## 动机

平台会话是执行 SillySpec 流程的场所，但"哪个会话跑了哪个变更/快速修复"这一关联目前不存在：变更侧仅有一个与实际执行无关的 best-effort 绑定（reparse 绑"最近活跃会话"）和一个割裂的单 FK 读取，快速修复侧完全没有会话关联。用户无法从变更/快速修复回看执行过程，也无法在会话列表按变更/快速修复缩小范围。

## 关键问题

1. **双轨割裂**：`change_session_links` 多对多表已存在但几乎无人写入，变更详情会话列表走 `AgentSession.change_id` 单 FK——同一个"变更的会话"概念有两套互相看不见的数据源。
2. **自动感知链路断点**：会话内跑 sillyspec 命令时平台已有全部线索（`tool_kind='sillyspec'` 打标、`SILLYHUB_SESSION_ID` env 注入、agent-logs 上报携带 hub_session_id + change_key/quick_id），但 hub 分支把 entry 的 ctx 完全忽略，命令也无人解析——线索齐了却没接通。
3. **快速修复零会话能力**：变更详情有「会话调试」卡与会话工作台，快速修复详情抽屉连一个会话入口都没有（用户明确要求补齐）。

## 变更范围

- 新表 `quicklog_session_links`（会话↔快速修复 M:N）+ 存量 `change_id` 播种迁移，变更侧关联收敛到 `change_session_links` 单一真相。
- 自动绑定双通道：run_sync 消息入库解析 sillyspec 命令（变更）+ platform_sync agent-logs 归属补绑（变更+快速修复，含 tool_report 聚合会话）。
- API：变更会话列表改读 M:N、新增快速修复会话列表端点、会话列表 M:N 筛选（change_id 语义扩大 + 新增 ql_id）、创建会话支持 quicklog_id 落绑定。
- 前端：快速修复抽屉关联会话卡、快速修复级会话门户新路由（QuicklogScope）、悬浮会话 quickId、会话列表「关联」筛选下拉。
- 详见 design.md §5（W1-W5）/§6 文件变更清单。

## 不在范围内（显式清单）

- 手动绑定/解绑 UI（绑定只由系统自动产生）
- 不修改 SillySpec CLI（全部平台侧实现）
- 不改会话/lease/run 状态机
- 不删除 `AgentSession.change_id` 列（保留双写，冻结语义）
- 不做绑定审计日志/通知
- 不做会话树行绑定徽标与绑定 toast（原型示意元素）
- 全局 `/sessions` 门户不加关联筛选（仅 workspace scope）

## 成功标准（可验证）

- 在平台会话内执行 `sillyspec run <任意阶段> --change <变更名>` 后，变更详情会话卡/工作台出现该会话（多对多：一会话多变更、一变更多会话均成立）。
- 会话内执行 `sillyspec run quick`（CLI 上报 agent-logs 后），快速修复抽屉出现该会话；本地直跑 CLI 的 tool_report 聚合会话同样出现。
- 快速修复抽屉可打开会话工作台、可新建自动绑定本快速修复的会话；`?session=` 深链恢复可用。
- 工作区会话列表按变更/快速修复筛选，命中集为 M:N。
- 未跑过 sillyspec 的会话行为完全不变；既有测试全绿（backend pytest + frontend vitest + tsc + gen:types check）。
