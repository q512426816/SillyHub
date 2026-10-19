<!-- 活跃坑索引：处置完成的条目移入 finished/（单坑单文件） -->
<!-- tick-timing-squash-blindspot.md：勾选时点「一把勾」警告结构性误报——判定读 git 历史形态与官方压扁口径自相矛盾+「对应提交」指令歧义+反馈只在收口终点（2026-10-16-change-title-condense-backfill 实证） -->

# 勾选时点「一把勾」警告结构性误报：判定依赖 git 历史形态，与官方压扁口径自相矛盾

- **发现日期**：2026-10-16（变更 2026-10-16-change-title-condense-backfill 收口实证）
- **影响面**：sillyspec CLI `src/flow.js` 勾选时点判定（约 :1472-1477）+ flow start 横幅的勾选证据文案（:1147）；收口体验面（advisory 不阻断，但每个按纪律干活的 agent 稳定复现）
- **类型**：工具行为缺陷（误报）+ 指令歧义，非使用失误

## 现象

flow done 收口打印：

> ⚠️ 勾选时点：tasks.md 的首次 git 提交 == 收口最后提交（一把勾模式）——token 证据齐放行，但边干边勾是进度锚……下次完成单元即勾

而实际执行过程**是**边干边勾的：task-01/02/03 每完成一格即 Edit 勾选、跑测试、带 task-NN token 提交交付代码。

## 判定机制（flow.js 实测口径）

```
tasksIn = git log --reverse --format=%h -- <changes/<名>/tasks.md> 的首行
lastIn  = git log --format=%h -n 1
tasksIn == lastIn → 「一把勾」警告；tasks.md 无任何提交 → 「untracked 直至归档」警告
```

只看 tasks.md **文件本身**的 git 历史；提交消息里的 task-NN token 由另一个哨兵（detectFakeCheckCompletion）单独校验，与本判定无关。

## 根因链（四层，均可复现）

1. **勾选动作与提交动作在执行循环里天然分离（核心）**：收口纪律要求交付代码显式 pathspec 提交（`.sillyspec/` 是共享面，宽松 add 会卷入并行会话文件——同日归档实证扫出 9 个他侧 changelog）。tasks.md 是流程状态不是交付物，永远不在 pathspec 清单里；勾选用 Edit 直改（CLI `task tick` 也不提交）。循环里不存在「把勾选带进提交」的步骤 → 每次都复现。
2. **指令歧义**：横幅「每格勾选要有对应提交（消息带 task-NN）」按字面=提交消息带 token 即可（本次全部满足，哨兵也放行）；时点判定却要求 tasks.md 文件修改本身入库。字面合规与该判定必然冲突。
3. **反馈只在收口终点**：执行全程无任何时点提示「勾未进 git」；advisory 不阻断 → 偏差到 flow done 才可见，对任何 agent 稳定产出。
4. **压扁放大器 + 自相矛盾（最关键的工具缺陷）**：官方口径明确「git 中间提交可 reset --soft 压扁为单提交，审计真相在 change.patch sha256 锚定，不依赖 git 历史形态」（flow done 收尾原文）。但时点判定恰恰依赖 git 历史形态——共享主仓上并行会话压扁归档（本次实证：5 个含渐进勾选的分次提交被压成 1 个）会把「边干边勾」的历史抹平，警告照样出。**官方允许的操作会无声摧毁该判定的依据。**

## 实证 trace（本变更）

- task-01/02/03 逐格勾选、逐次带 token 提交交付代码（tasks.md 未随提交——见根因 1）；
- task-04/05 提交含 tasks.md（渐进历史存在过）；
- 并行会话 reset --soft 压扁 → 分次提交被并成 `ed3fc43bf` 单提交；
- flow done 时 tasks.md 首次提交 == HEAD → 警告触发。

## 工具侧改进要求（待工具组实施）

1. **反馈前移（最小改动）**：`task tick` 顺带打印就绪提交命令（含 tasks.md pathspec + task-NN token）；或 tick 时检测「上一格勾选仍未进 git」当场提醒。断掉根因 1/3 的复现链。
2. **判定依据换源（治本）**：勾选时点判定从 git 历史形态改为 flow-state 的逐格 tick 时间戳（tick 事件流），天然免疫压扁，与「审计真相不依赖 git 形态」口径对齐。
3. **修横幅文案歧义**：「对应提交」明确为「该格 tasks.md 修改必须与该任务交付**同一提交**入库（pathspec 含 tasks.md）」。

## 处置状态

- 平台侧无需处置（误报不阻断，token 证据链完整）；本条待工具组按上述三点修复后移入 finished/。

## 处置记录（2026-10-17）——工具侧三点已落，坑关闭

- **要求 1（反馈前移）已落**：sillyspec 仓变更 `2026-10-17-tick-timing-source`（归档提交 d47f7cf0）——`task tick` 翻格成功回显两行现成命令（`git add -- <交付文件…> tasks.md 侧车` + `git commit -m "<概括> (task-NN)" -- 同清单`），untracked 场景可一次照抄；已勾 ≥2 格且 tasks.md 零 git 提交时当场一行提醒「此前勾选未随交付入库」——反馈不再等到 flow done 终点（根因 1/3 复现链断）。
- **要求 2（判定依据换源·治本）已落**：flow.js 勾选时点判定的 git 历史读法（`--reverse` 首提交 == HEAD / untracked 两条 warn）整体退役，换 `detectTickTiming` 纯函数读 task-ticks.jsonl 侧车逐格墙钟时戳——跨度 >120s 即「边干边勾确认」✅ 行（超窗即铁证）；挤 ≤120s 短窗且变更存活 ≥10×跨度才「末尾集中勾选形态」⚠️ advisory；缺锚/单格/无观测各自静默或一行教学。墙钟时戳是侧车文件事实，压扁/rebase 不可改写——与「审计真相锚 change.patch sha256、不依赖 git 形态」口径对齐（根因 4 消除）。e2e 回归钉死本坑场景：侧车时戳分散 + git 压扁形态 → 零「一把勾」警告。
- **要求 3（横幅文案消歧）已落**：flow start 横幅（勾选证据行+交付纪律行）、brainstorm 收编教学行、任务未全勾拒收行统一口径——「对应提交」=消息带 task-NN **且 pathspec 带上本变更 tasks.md（勾选修改与任务交付同一提交入库）**，并指向 task tick 回显的现成命令（根因 2 消除）。
- **附带的等价重构**：事件流+侧车观测采集前置为共享 `_tickObs`（时点判定与勾选节奏门一份数据，防双报：节奏门检出单拍跳/突发时判定让位）。
- **如实留痕的取舍**：watcher 3s 采样事件刻意不作时点判据（部分观测会把分散勾选采样成尾窗聚集，与采样合并跳系列坑同源）；agent 全程直接 Edit 的末尾逐格集中形态两类门都不报（无侧车观测只出一行教学引导走 task tick）——advisory 语义下可接受的盲区，见归档件 design「风险与死路」。
