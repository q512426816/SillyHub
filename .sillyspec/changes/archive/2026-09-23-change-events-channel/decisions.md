---
author: qinyi
created_at: 2026-09-22 20:11:04
generated_by: sillyspec-fourpiece-init
change: 2026-09-23-change-events-channel
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1：事件端点落 platform_sync 模块（CLI→平台推送统一入口）

- **问题**：`POST/GET /api/changes/{name}/events` 新端点放哪个模块？
- **选项**：A) platform_sync 模块（与 progress/quicklog/agent-logs 同居）；B) change 模块（变更中心读写域）；C) 独立新模块 events。
- **决策**：A。
- **理由**：watcher 推送与 spec-sync/quicklog/agent-logs 同属「sillyspec CLI → 平台 best-effort 上行」通道：鉴权（`require_platform_sync_write`/`require_platform_sync`，backend/app/modules/platform_sync/auth.py:153-176）与 workspace 派生语义完全同款（用户规格明言"鉴权用既有平台 token 体系，与 spec-sync 推送同款"）；change 模块是浏览器侧变更中心 CRUD 域，混入 CLI 推送观测面会破坏其读写边界；独立模块为两张表+两端点过度拆分。
- **锚点**：backend/app/modules/platform_sync/router.py
- 模块域: backend
- **故障面**：platform_sync/router.py 路由继续膨胀（本件 +2 端点）；参数路由 `/changes/{name}/events` 须避开字面量 `-` 占位段（既有 R-06 顺序坑），注册位置放在 `/changes/{name}/progress` 等参数路由同区即可，不新增字面量段。
- **退役判据**：事件面若演化出独立消费逻辑（告警联动/规则引擎），再拆独立模块。

## D-002@v1：append-only 新表 platform_change_events + dedup_key 服务端生成

- **问题**：存储形态与幂等去重键？
- **选项**：A) 新表 `platform_change_events`，(workspace_id, change_name, dedup_key) 唯一约束，重复键**跳过不覆盖**；B) 复用 platform_change_progress 加 JSON 列追加；C) 事件 id 客户端必填天然去重。
- **决策**：A。
- **理由**：progress 表是 `(workspace_id, change_name)` 单行聚合（backend/app/modules/platform_sync/model.py:59-65 复合唯一约束），往 JSON 列 append 无法做数据库级去重与上限修剪；CLI 当前事件**无 id**（watcher.js `mk` 构造仅 ts/kind/stage/detail/provisional），C 不成立。事件是不可变事实，去重语义为「同键跳过」（区别于 quicklog 的整条覆盖 D-004 先例）。
- **dedup_key 生成规则**：body 带 `id` 字段 → 用之；否则 `f"{ts}|{kind}|{stage or ''}"`（stage 可空，空串参与拼接——SQL 唯一约束 NULL≠NULL 会放空 stage 重复行，拼串规避）。
- **锚点**：backend/app/modules/platform_sync/model.py
- 模块域: backend
- **故障面**：同毫秒同 kind 同 stage 的两条真异事件（如两文件同刻变更且 detail 同）会被误去重——可接受（观测面丢一条无碍，--done 才是真相）。
- **退役判据**：CLI 侧事件带上稳定 id 后，dedup_key 退化为 id 直传。

## D-003@v1：ts 服务端归一为 timezone-aware DateTime（非 ISO 原文 String 先例）

- **问题**：时间字段存什么形态？CLI 推的 ts 是 **epoch 毫秒 number**（watcher.js `mk`: `ts: next.ts`），不是 agent-logs 的 ISO 原文 String。
- **决策**：服务端归一为 `DateTime(timezone=True)` 列存储；GET `?since=<iso8601>` 解析为 aware datetime 做 `ts >` 严格比较（增量不含边界）；响应输出 ISO 8601 字符串。
- **理由**：agent-logs 的 D-003「ISO 原文 String 字典序」前提是 CLI 恒发 UTC Z 格式字符串，本通道 CLI 发 number，字典序先例不适用；归一 DateTime 后排序/比较/跨时区唯一口径，且 `since` 天然 ISO。epoch 秒/毫秒歧义按毫秒解析（watcher 轮询 3s 粒度，毫秒值域 >1e12 可直接判别）。
- **锚点**：backend/app/modules/platform_sync/model.py
- 模块域: backend
- **故障面**：客户端推秒级时间戳（值域 <1e12）会被解析成远古时间——接收侧只认毫秒并在异常时 422（CLI 契约固定毫秒）。
- **退役判据**：CLI 改推 ISO 字符串时重评（届时可双形态兼容解析）。

## D-004@v1：平台对 provisional 事件只展示不消费（红线落库形态）

- **问题**：平台侧对事件做多少业务判定？
- **决策**：零业务逻辑。后端只做存储+读取+去重+上限四个通用动作；severity/kind/rule 全部原样存原样回，不触发通知/不写 progress/不影响审批门控；前端只读时间线展示。
- **理由**：sillyspec 侧单写者纪律——`--done`（progress 推送）是唯一流程真相，watcher 事件恒 `provisional:true` 只是旁路观测信号（用户规格红线："事件区只读展示零业务逻辑"）。若平台开始消费 provisional 事件，会形成第二真相源与 CLI 抢写。
- **锚点**：backend/app/modules/platform_sync/service.py
- 模块域: backend, frontend
- **故障面**：无（本决策是克制性约束）。
- **退役判据**：出现明确的产品需求要消费事件信号（届时独立变更评估，不在本表静默突破）。

## D-005@v1：上限保护=截断最旧（非拒绝），5000 条/变更

- **问题**：单变更事件刷爆防护——截断还是拒绝？
- **决策**：插入成功后按 (ts, created_at) 删最旧修剪到 5000 条（同事务）；`MAX_EVENTS_PER_CHANGE=5000` 常量。
- **理由**：拒绝会让 watcher 持续 4xx 产生噪声（CLI best-effort 静默但日志告警）；事件价值密度新>旧（面板看当前态）；5000 上限按用户规格。观测面数据可丢（本地 jsonl 才是 CLI 侧真相源），截断无损主线。
- **锚点**：backend/app/modules/platform_sync/service.py
- 模块域: backend
- **故障面**：修剪与并发插入竞态可能瞬时超限几条——无害（下次插入再修）。
- **退役判据**：事件量级实证远低于上限时可简化掉修剪逻辑。

## D-006@v1：前端折叠区落详情页 aside，自取数组件 + 30s 轮询

- **问题**：观测事件区放哪、怎么取数？
- **决策**：新建 `ChangeEventsCard` 组件挂变更详情页次线（aside），与 QuicklogLinkedCard 同款「组件 useQuery 自取数 + 传参挂载」先例（frontend/src/components/changes/detail/quicklog-linked-card.tsx:31-47）；`refetchInterval: 30_000`；`refetchOnWindowFocus: false`；失败静默隐藏（不阻断详情主内容）。
- **理由**：详情页主线（审批卡/步骤时间线）是流程真相区，观测信号属辅助信息与 quicklog/对账卡同居次线；轮询而非 SSE（用户规格："SSE 升级可选非本件必须"）；30s 与事件侧价值密度匹配（watcher 轮询 3s 产生事件，无需秒级）。
- **折叠行为**：缺省收起；列表含 `severity=warning` 事件时默认展开 + 标题角标显示 warning 计数（醒目但不打断）。
- **锚点**：frontend/src/components/changes/detail/change-events-card.tsx
- 模块域: frontend
- **故障面**：30s 轮询在长驻详情页产生持续请求——react-query 页面不可见自动暂停（refetchIntervalInBackground 默认 false）缓解。
- **退役判据**：SSE 通道（/sessions/events 先例）扩展到变更事件时替换轮询。

## D-007@v1：事件 schema 宽松接收（kind/ts/provisional 必填轻校验，rule/severity/id 可选）

- **问题**：请求 schema 定多严？
- **决策**：`events: [...]` 批量数组；每条 `kind`(str 必填)、`ts`(epoch ms number 必填)、`stage`/`detail`/`rule`/`severity`/`id` 可选；`provisional` 可选 bool（服务端恒存 True——存接收值归一：无论推什么，落库 provisional 恒 True，防御伪造非 provisional 事件混入）；未知字段 `extra=ignore` 静默丢弃（AgentSessionLogORM D-002 先例：CLI schema 升版不 422）。单批上限 200 条（422 超限），单条 detail 截 2000 字符。
- **理由**：当前 CLI 事件面是 kind/stage/detail/ts/provisional 五字段（watcher.js mk），用户规格提及 rule/severity 是哨兵规则化后的扩展面——宽松接收一步到位；provisional 恒 True 是 D-004 红线在数据层的落地（平台不承认非 provisional 事件）。
- **锚点**：backend/app/modules/platform_sync/schema.py
- 模块域: backend
- **故障面**：宽松 schema 放过畸形 kind 字符串——展示层原样渲染无害（零业务消费）。
- **退役判据**：CLI 事件面正式版本化后收紧为枚举。

## D-008@v1：迁移 down_revision 改接 20260922194500（执行期裁决，task-01）

- **问题**：任务卡与 design 写码时点当前 head 为 20260920220000，但 baseline checkpoint 前主仓 merge 53a5c5c9d（session-fork-continuation）将 session_fork_columns 迁移（20260922194500）入链，实测该 revision 才是当前唯一 head。
- **决策**：down_revision 接 20260922194500。
- **理由**：按卡写 20260920220000 会裂成双 head 直接 break `alembic upgrade head`（knowledge known-issues「alembic 并行变更撞 revision 多 head 启动 crash-loop」同款坑）；接真实 head 是唯一不破坏迁移链的选择。
- **锚点**：backend/migrations/versions/20260923040000_add_platform_change_events.py
- **模块域**: backend
- **故障面**：无（跟随真实 head 的机械修正）。
- **退役判据**：无。
