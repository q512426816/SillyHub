---
author: flow-machine-draft
created_at: 2026-10-22T00:09:27.498Z
---
# 设计记录（Design Record）— 2026-10-22-file-card-hide-empty

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

把「无数据的轮级文件变更卡」从**渲染降级卡**改成**不出卡**：唯一判定点收敛在纯映射 `toFileChangesCardProps`（`frontend/src/components/daemon/file-changes/turn-file-changes.ts`）——`capability="tool_only"` / `snapshot=null` / `status=failed|unavailable` 三条分支一律 `return null`，轮级挂载层（`turn-timeline.tsx` 已是「`null` 不出卡」语义）零改动，因此不会出现「映射改了但挂载层还占位」的错位。

会话级汇总同步收窄：`aggregateTurnFileChanges` 跳过无可信快照的轮（不再计入 `degradedTurns`、不再把状态压到 `partial`），`FileChangesSummary` 在 `totalFiles === 0` 时整卡零渲染，「其中 N 轮无工作区快照（仅工具编辑）」提示行删除。选这个方案的理由：缺陷是**呈现策略**而不是数据链路——daemon 侧实测无故障（0.2.0 采集器 `status=ok` / 46 files / 165ms），历史轮本来就拿不到快照（部署前的轮没有 `daemon_run_snapshots` 行），所以只需在「无信息」的判定处收口，不动 DTO、不动后端、不动 daemon。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `toFileChangesCardProps(snapshot, capability, options)`：签名不变，**行为变化**——`capability==="tool_only"`、`snapshot==null`（capability 已给）、`snapshot.status in {failed, unavailable}` 三条分支由「返回降级 props」改为 **返回 `null`**（不出卡）。`ok+files=[]` 仍返回 `null`；`partial+files=[]` 仍返回一行提示 props（`NOTICE_PARTIAL_NO_FILES`）。
- `aggregateTurnFileChanges(entries)`：返回类型**删字段** `degradedTurns`（无快照轮不再参与统计）；`consideredTurns` 语义收窄为「参与汇总且有可信快照的轮」。`status` 不再因「有轮缺快照」被压到 `partial`。
- `FileChangesSummary`：`totalFiles === 0` → 返回 `null`（原先 `degradedTurns>0` 也会渲染）；删除 `data-testid="file-changes-summary-degraded"` 段落与其文案。
- `FileChangesCard` 的 `degraded` 形态：**组件能力保留**（仍受组件级用例保护、proto/检查器形态可能复用），但本变更后产品页**无生产者**——在组件头注释标注「当前无产品侧调用方」。
- **无**后端改动、**无** daemon 改动、**无** DTO/API 字段变化、**无** 新端点。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/components/daemon/file-changes/turn-file-changes.ts` | 三条「无数据」分支改返回 `null`（不出卡）；模块头三态表同步改写 |
| 修改 | `frontend/src/components/daemon/file-changes/file-changes-summary.tsx` | 跳过无可信快照的轮、删 `degradedTurns` 与缺口提示行、零文件整卡零渲染 |
| 修改 | `frontend/src/components/daemon/file-changes/file-changes-card.tsx` | 仅注释：`degraded` 形态保留但产品侧暂无生产者 |
| 修改 | `frontend/src/components/daemon/turn-timeline.tsx` | 仅注释：轮级挂载面「tool_only → 降级卡」改为「无数据 → 不出卡」 |
| 修改 | `frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts` | 按新口径改断言（tool_only / null / failed / unavailable → `null`），补 partial 保留用例 |
| 修改 | `frontend/src/components/daemon/file-changes/__tests__/file-changes-summary.test.tsx` | 删缺口提示断言、补「全 tool_only → 零渲染」「混合 → 只统计真实轮」 |
| 修改 | `frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx` | tool_only 轮改为断言「整轮不出卡 + 全树无『仅工具编辑』/『无改动』」 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。判定是「每轮独立、无跨轮状态」的纯函数：快照迟到只影响该轮的出卡时机（快照到位前 `snapshot=null` → 不出卡；到位后 `useMemo`/投影缓存让该轮重新求值并出卡）。汇总聚合同样是输入驱动的纯函数，`turns` 引用变化即重算，不存在「先隐藏后不再显示」的粘滞态。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：本变更只在渲染层做纯函数判定，不写任何数据/文件，也没有共享可变状态；`FILE_CHANGES_PROJECTION_CACHE`（WeakMap）的键是轮对象、值是不可变投影，多标签页各自持有自己的 React 树，互不影响。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。隐藏是无状态判定（不引入 `useState`/`useEffect`），切换会话/视图不产生额外副作用；轮级卡与汇总卡都只依赖 props。唯一的行为差别是「无数据的轮从有占位变无占位」——这不影响滚动锚点（该占位原本 28px 高，减少高度只会让内容更短，`overflowAnchor:none` 与贴底逻辑不依赖它）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。判定输入只来自本会话 `turns` 上的 `fileChanges` / `fileChangesCapability`（由 `attachRunFileChanges` 按 `realRunId ?? runId` 投影），无跨会话/跨实例取数；汇总同样只吃本会话的轮数组。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：把「采集失败」也一起隐藏后，**排障信号丢失**——用户看到的是「这一轮没有卡片」，无法区分「这轮真的没改文件」与「这轮快照没采到」。这是用户显式选择的取舍（「全部隐藏，连接提示也不要」）；缓解＝失败原因仍留在数据面（`/runs` 的 `file_changes.status`/`reason`、daemon 结构化日志 `turn_file_changes_collected`），需要时可从接口/日志复查，不靠 UI 占位。**回退方式**：把三条分支改回返回 `degradedProps(...)` 即恢复旧形态（一行改动，测试同步改回）。
- **试过但放弃**：①保留「仅工具编辑」卡但改成 12px 一行弱提示——用户明确不要任何缺口提示，且 58 行提示仍是噪音；②只在「末轮」出降级卡（父变更 R-18 的建议）——仍需 UI 有一个「本会话快照不完整」的出口，与「全部隐藏」冲突；③从 daemon 侧补历史轮快照——历史轮已经结束、工作区状态早已变化，事后采集出来的数据是伪值（等于伪造改动清单），D-023 的「禁止把没有快照显示成没有改动」同样禁止反向伪造。
