# 符号影响面报告

> tasks.md 内容指纹（生成时）: 79f4a908c59004e2——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。
>
> 扫描口径（2026-10-21 execute step2，worktree HEAD=baseline checkpoint 98555b69 + 主仓在途 105 文件 overlay）：
> `rg` 逐符号搜 `frontend/src`、`backend/app/modules/daemon`、`sillyhub-daemon/src/interactive`，调用点与 TaskCard `allowed_paths` 对比。
> 结论：**本变更无「破坏性签名变更」**——全部为新增文件 / 新增可选字段 / 新增可选入参（缺省等价旧行为），因此不触发「调用点不在范围内 → 阻断」。

- task-01: 无签名级变更（已完成登记）。已落盘改动为可选入参 + 样式：`TurnTimeline.detailLevel?`（`turn-timeline.tsx:384-...`，无外部传入）、`RoundDivider.detail?: string`（`round-divider.tsx`，缺省零视觉变化）、`AttachmentChips.tone?`（缺省 `onPrimary`）。调用点：`turn-timeline.tsx` 内部透传 `detailLevel`（唯一）、`round-divider` 各调用方均不传 `detail`（走缺省分支）——全部在 allowed_paths 或兼容默认行为内。
- task-02: 无签名级变更（已完成登记）。`buildTrajectory(logs, runs, opts?)` 与 `buildTrajectoryLanes(rows, turns)` 均为既有导出，`TrajectoryView` props 未变；生产调用点仅 `frontend/src/app/proto/session-trajectory/trajectory-proto-view.tsx:63`（在范围内），其余调用点在 `trajectory/__tests__/`。
- task-03: 无签名级变更（已完成登记）。`FileChangesCard` props（`file-changes-card.tsx:72`）为新增组件自身契约；调用点 = `frontend/src/app/proto/session-file-changes/page.tsx:155/169/183/213`（4 处，dev 路由内，在 allowed_paths 之外但属本变更同批新增文件）与 `file-changes-card.test.tsx`（8 例）。无其他生产调用方。
- task-04: 无签名级变更（已完成登记）。leadger 侧只有新增端点 `GET /sessions/{session_id}/model-usage` 与两个只读响应模型（`session_insights.py:933-1052`）；`frontend/src/lib/api-types.ts` / `sillyhub-daemon/src/api-types.ts` 为生成物，无手写调用点改动。
- task-05: 无签名级变更（纯 CSS 覆盖面）。`session-redesign.module.css` 的 `.v2 :global(.seg-text-body)` 规则删除/改值；无 TS 符号、无调用点；生产面零引用（仅 `/proto/*` 生效）。
- task-06: 无签名级变更（纯文档）。`design.md` / `tasks.md` 的 `file:line` 锚点校正，不产生任何代码符号变化；核对目标 `turn-timeline.tsx:2129-2133`、`:2052-2054`、`lease/service.py:1168-1196`、`session_insights.py:933-1052`、`session-manager.ts` 现 2405 行。
- task-07: 无签名级变更（纯截图证据）。新增 3 个 PNG 到变更目录，不改 `src`。
- task-08: 无破坏性签名级变更（纯新增）。新增 pydantic 模型 `TurnFileChange` / `TurnFileChangesSnapshot` / `TurnTimingSnapshot` / `FileChangesCapability`（`schema.py` 追加，不改既有类）、新增侧表 `DaemonRunSnapshot`（`model.py` 追加，不动 `agent_runs` 列）、新增私有方法 `_upsert_run_snapshot`（`lease/service.py`；既有 `_upsert_batch_model_usage` 唯一调用点 `:457` 不动）、`session_insights.py` 另起投影段（model-usage 段 `:933-1052` 一行不改）。轮次读模型响应**只加字段**（`file_changes` / `file_changes_capability` / `timing`），旧消费者不受影响；`api-types.ts` 由 `pnpm gen:types` 重生成。调用点：无「不在 allowed_paths 的调用方」。
- task-09: 无签名级变更（新增模块 + 内部接线）。新增 `collectTurnFileChanges`（`turn-file-changes.ts`）与 DTO 类型（`turn-file-changes-types.ts`），无既有导出改动；`session-manager.ts` 改的是私有方法 `_runConsume`（`:1189`）/`_onResult`（`:1593`）内部实现，`_registerAgentToolUseMeta`（`:1612`）不动、事件协议不动。调用点：`_onResult` 仅类内调用（`:1155` / `:2352` 起协程链），无外部引用。
- task-10: 无签名级变更（新增纯函数 + 同接线点追加字段）。新增 `deriveTurnTiming`（`turn-timing.ts`）；`session-manager.ts` 在 task-09 已改的同一 `_onResult` 异步块追加 timing 上报，不改任何导出签名、不增事件类型、不新增 `timingCapability` 旁路键。调用点与 task-09 相同（类内）。
- task-11: 无破坏性签名级变更（新增可选字段 + 新增组件）。`SessionTurnView`（`turn-timeline.tsx:263`）追加**可选** `fileChanges?` / `fileChangesCapability?`——该类型被广泛 import（`session-panel/*`、`lib/agent-log-turns.ts`、`runtime-session-helpers.tsx`、`sessions/subagent-catalog.tsx` 及约 20 个测试文件），但全部以 `Partial<SessionTurnView>` / 子集构造，可选字段不破坏任何调用点（在范围内：只加 props 透传，`session-panel-page.tsx:1697/1721` 的 `runsMeta` 消费点）；`FileChangesCard` 追加可选 `capability?`——调用点 = `proto/session-file-changes/page.tsx`（4 处，不传走旧行为）+ `file-changes-card.test.tsx`（8 例需保持绿）。新增 `toFileChangesCardProps` / `FileChangesSummary` 无既有消费者。
- task-12: 无破坏性签名级变更（新增可选入参 + 新增返回字段）。`buildTrajectory` 的 run 入参追加可选 `timing`，返回 `Trajectory` 追加 `modelBasis: "observed" | "approx"`；内部 `deriveModelSpans`（`build-trajectory.ts:780`）为私有函数。调用点：生产唯一 `trajectory-proto-view.tsx:63`（不传 timing → 走 approx，行为与现状一致），其余在 `trajectory/__tests__/build-trajectory.test.ts`（31 例需保持绿）。`trajectory-timeline.tsx` 只加标注渲染。
- task-13: 无签名级变更（发版步）。只改 `sillyhub-daemon/package.json` 的 `version`（0.1.1 → 0.2.0），`daemon-version.ts` 语义不变（读 package.json 唯一来源）；调用点无新增。`tests/version.test.ts` 关联但无需改断言（版本号由包读取）。
- task-14: 无签名级变更（纯文档）。四个模块文档增量补段，doc 中的 `file:line` 锚点必须指向已落地代码；不改任何源码符号。
- task-15: 无签名级变更（豁免清理 + 回归）。只删 `.sillyspec/local.yaml` 的 `known_failures` 条目（机器本地文件，非代码符号），复跑既有测试；不改源码/测试来「让全量绿」。
