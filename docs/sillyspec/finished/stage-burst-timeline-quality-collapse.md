---
title: stage-burst 收口使平台步骤时间线质量崩塌——同秒批量时间戳 + CLI 合成占位 output + 变更窗口空文件名 + 双通道重复推树
date: 2026-09-24
status: 活跃（工具缺陷，待 sillyspec 仓修复）
source: 2026-09-24-change-events-r15-sf 平台时间线实证（change 6969e193-1ad0-44bc-b71f-c3ec4a7baaea，对比 2026-09-22-session-fork-continuation）
---

# stage-burst 收口让平台「步骤时间线」退化成占位流水账

> 一句话结论：**本仓 `.sillyspec/local.yaml` 开了 `stage.burst: true`（2026-09-22
> sillyspec 工具引入），主阶段一次 `--done` 会把剩余步骤全部收口——每步时间戳是
> 同一秒、内容是 CLI 合成的占位文案、文件窗口还常常取错仓且文件名为空；叠加
> daemon 终态点/sessionEnd 双推文件树，平台侧时间线与文件版本都出现劣化。**
> local.yaml 注释里「行为不变，仅省 prompt 往返」的假设不成立：省往返的代价
> 恰恰是时间线的真实性与信息量。

## 实证（2026-09-24 两变更对比）

| 维度 | 2026-09-22-session-fork-continuation（burst 前） | 2026-09-24-change-events-r15-sf（burst 后） |
|---|---|---|
| 步骤 output | 每步 agent 手写真实摘要（加载内容/确认结论/commit hash/测试数） | 大部分步骤为 `【CLI 合成】步骤「X」完成；变更窗口 N 文件（、）…` 占位文案 |
| completed_at | 每步各自真实时刻 | execute #1-#9 九步同为 `2026/9/24 17:58:23`（一次 burst 收口同秒完成）；plan #0-#3 同为 `17:24:59` |
| 状态一致性 | 无矛盾 | verify #1 状态 pending 却挂着「已完成」的合成 output（burst 收口后 reopen/stale 拉回不清 output） |
| 变更目录同步文件数 | 51 个（含每步中间产物） | 20 个（burst 少了逐步 CLI 触点 → 中间产物不再生成/上推） |

时间线乱序实证：verify「进度确认」完成于 18:06:38，而 execute 后段步骤完成于
18:32-18:34（verify lint 门拦下缺陷回 execute 补作业），批量戳 + 回补交叉后页面
时间线不可读。

## 根因链（sillyspec 仓源码依据）

1. **burst 分发门**：`src/run/command.js:1729-1732` —— 白名单主阶段
   （`STAGE_BURST_STAGES` = brainstorm/plan/execute/verify/archive，
   `src/run/shared.js:1979`）+ `readStageBurst`（local.yaml `stage.burst: true`
   或 env `SILLYSPEC_STAGE_BURST=1`，`shared.js:1957`）→ `completeStepBurst`
   循环收口。
2. **循环同秒戳**：`src/run/complete.js:533` 每轮
   `completedAt = new Date().toLocaleString('zh-CN',{hour12:false})` —— 毫秒级
   循环 + 秒级字符串 → 剩余步骤全部同秒。时间语义从「工作发生时刻」变成
   「收口时刻」。
3. **占位 output**：burst 每轮 `outputText=null`（`complete.js:1246` 设计如此），
   `complete.js:241` 走 `synthesizeStepOutput`（`complete.js:136-149`）——纯占位，
   无任何变更语义。
4. **变更窗口双坑**（`complete.js:139-146`）：
   - 未跟踪目录条目 `?? dir/` 经 `p.split(/[\\/]/).pop()` 得空串
     （`filter(Boolean)` 在 pop 之前）→ 「变更窗口 2 文件（、）」；
   - `git status` 跑在 `cwd`（常为主仓根）而非变更 worktree → 窗口清单与该
     变更实际文件无关（brainstorm 期说 2 文件，变更终态 9+ 文件）。
5. **pending 带完成 output**：burst 收口先落 output，随后 reopen/stale 拉回
   （`complete.js` 轮首拉回仅改 status）不清 output → 矛盾态行。
6. **双通道重复推**：CLI 侧 `triggerSync` ×17 调用点 → `bg-sync.js` detached
   后台进程（单飞锁 + 最多 5 轮/2.5min）推 progress+四件套+spec 树；daemon 侧
   `daemon.ts:4145`（scan/stage 终态点）与 `:4725`（onSessionEnd
   `_postInteractiveSpecSync`）double-sync 整树（注释自称「无害」，但同一文件
   version 一路涨到 9，两通道对 base_version 的竞争面在放大）。

## 绕过（当前可用）

- 本仓 `.sillyspec/local.yaml` 删掉 `stage.burst: true`（或会话 env
  `SILLYSPEC_STAGE_BURST=0`）→ 恢复逐步真实 `--output` + 真实时间戳。代价是
  agent-CLI 往返次数回到 burst 前水平。

## 待工具修复清单（建议给 sillyspec 仓）

1. burst 收口时间戳：循环内保单调递增（毫秒源或 +1s 递增），或步骤行记
   `startedAt`（X3 步骤开始上报已有时刻源）供收口时回填真实区间。
2. `synthesizeStepOutput`：basename 空串过滤（pop 后再 filter）；git 窗口改在
   变更 worktree/`platformOpts.specDriftAnchor` 下取；或窗口段整体下线
   （错误窗口比没有更误导）。
3. reopen/stale 拉回清 step.output（或平台渲染侧 pending 步不显示 output）。
4. burst 下保留 agent 整体 `--output` 的落步归属（现仅打横幅不落步记录，
   `complete.js:1246` D-009）——至少把它落到末步或阶段摘要，别让全阶段无语义。
5. 文件树同步收敛单一 owner：daemon 增量文件通道为主，CLI 侧不重复推整树
   （或反之），消除 base_version 竞争。

## 处置记录（2026-09-25）

**已修（sillyspec 仓工作树，未提交；坑清单 1/2/3）**：

1. **burst 同秒戳（清单 1）**：`completeStepBurst` 增单调时钟——每轮 completedAt
   取「真实时刻（秒粒度比较后更新）否则上一轮戳 +1s」，轮间字符串严格互异且递增；
   `completeStep` 增 `completedAtOverride` 透传（单步路径不传，落真实时刻不变）。
2. **synthesizeStepOutput 双坑（清单 2）**：basename 空串过滤移到 pop 之后（`?? dir/`
   不再产出「（、）」，全空只报计数）；窗口归属性判定——平台模式（specRoot 锚定，
   变更文件不在 cwd 仓）窗口段整体缺省（错误窗口比没有更误导），worktree 内执行
   （specDriftAnchor）与纯本地维持原行为。`command.js` auto 路径调用点同步传
   platformOpts。
3. **拉回清残留（清单 3）**：burst 轮首 stale 拉回从只改 status 扩为同时清
   output/output_truncated/output_original_length/completedAt——pending 步不再挂
   「已完成」合成文案的矛盾态（与 reopenStage fromStep 步口径一致）。

**测试证据**（sillyspec 仓）：`test/stage-burst.test.mjs` 追加 ⑪（时间戳互异且递增）
⑫（requiresWait 断点上稳定观察拉回清残留）⑬（窗口归属性 + 空名过滤）三例，连跑
稳定通过；complete/burst/output 相关回归（align-execute-review-gate、
auto-dualtrack-brainstorm、execute-concurrent-done-guard、execute-batch-*、
output-*、noai-completion-gate、plan-continue-conditional-wait、fullflow-feedback-five
等）全绿。

**延后（设计决策级，需拍板，不属缺陷修补）**：

- 清单 4（agent 整体 `--output` 落步归属）：现行为是记录在案的 D-009 决策
  （不落步记录——语义错归属污染步骤审计面），反转或落阶段摘要需改平台摄取面，
  留设计项。
- 清单 5（文件树同步单一 owner）：daemon 终态点 + onSessionEnd 双推是带注释的
  D-006@v1 决策（整树覆写幂等 + 兜底可见性），收敛需 CLI/daemon 跨仓协调
  base_version，留架构提案。
- 「变更目录 51→20 文件」是 burst 模式固有代价（CLI 触点减少 → 中间产物减少），
  非缺陷；需要全量中间产物时关 `stage.burst`（文件「绕过」节已述）。

**另注**：本轮处理时 `test/stage-burst.test.mjs` ⑩ 用例在 sillyspec 工作树被并行
会话在途改动改坏（makeRepo 返回值当对象取 `.cwd`，HEAD 版本正确）——非本坑修复
引入，留该会话收敛。
