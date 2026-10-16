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
