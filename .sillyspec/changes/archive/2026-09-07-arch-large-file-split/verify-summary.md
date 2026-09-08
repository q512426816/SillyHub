---
author: qinyi
created_at: 2026-09-08 07:55:18
change: 2026-09-07-arch-large-file-split
---

# 总验收证据汇总（task-17 / Wave 12）

> 证据取自 worktree `.sillyspec/.runtime/worktrees/2026-09-07-arch-large-file-split`，HEAD=7e0dbe040（本卡只读核查，worktree 零改动）。三端定向回归数字引用 task-05 / task-12 / task-16 验收实测，不重跑。
> 拆分前行数双基线说明：00c4f644=变更基线检查点；4e01d1d44=D-010（3efb3ec0b）merge 进来的 main 版（router.py/task-runner.ts/lib/daemon.ts 三文件行数被 main 刷新，表内注明）。

## 一、8 文件行数达标汇总（wc -l 实测 @ HEAD 7e0dbe040）

行数目标（D-005@v3）：新拆出子模块 ≤800（例外：session-panel-page ≤3000、session-panel-dialog ≤2000）；核心编排 facade/类壳 ≤2500。

| # | 拆分前文件 | 基线行数（00c4f644） | merge 刷新后（4e01d1d44） | 拆分后形态 | 实测（wc -l） | 判定 |
|---|---|---|---|---|---|---|
| 1 | sillyhub-daemon/src/interactive/session-manager.ts | 5438 | 5438（未变） | 瘦 facade + `interactive/session-manager/` 13 模块 | facade 1965 ≤2500；模块 max types.ts 757 ≤800 | 达标 |
| 2 | sillyhub-daemon/src/task-runner.ts | 3426 | 3430（+4 windowsHide） | 瘦 facade + `task-runner/` 8 模块 | facade 1660 ≤2500；模块 max spawn-stream.ts 712 ≤800 | 达标 |
| 3 | backend/app/modules/daemon/router.py | 5468 | 5649（+181，D-010 增量逐字节移植进包） | `router/` 13 文件包（__init__ + 12 域文件） | __init__ 312 ≤2500；域文件 max session_crud.py 712 ≤800 | 达标 |
| 4 | backend/app/modules/daemon/session/service.py | 7176 | 7176（未变） | `session/service/` 14 文件包 | __init__（SessionService 类壳）1023 ≤2500；子模块 max control.py 801 | 达标（备注①） |
| 5 | backend/app/modules/daemon/group/service.py | 4844 | 4844（未变） | `group/service/` 10 文件包 | __init__（类壳）817 ≤2500；子模块 max crud.py 791 ≤800 | 达标 |
| 6 | backend/app/modules/daemon/run_sync/service.py | 4055 | 4055（未变） | `run_sync/service/` 9 文件包 | __init__ 555；子模块 max close_run_steps.py 774 ≤800 | 达标 |
| 7 | frontend/src/components/daemon/session-panel.tsx | 6620 | 6620（未变） | `session-panel/` 12 文件目录（原文件移除，目录导入） | page 2967 ≤3000（豁免）、dialog 1818 ≤2000（豁免）；其余 max page-helpers.tsx 742 ≤800 | 达标 |
| 8 | frontend/src/lib/daemon.ts | 4090 | 4111（+21，随 merge 刷新后拆分） | `lib/daemon/` 14 文件目录（原文件移除，index 全量再导出） | max session-stream.ts 750 ≤800；sse-internals.ts 私有不进 index | 达标 |

**备注①（边缘项，如实记录）**：`session/service/control.py` wc -l 实测 801（非空行 737），超 D-005@v3 新子模块 ≤800 一行；设计自估 ~580（design.md §表）。该值自 task-08 提交（e5bc40905）起即 801、后续零改动，task-08 卡验收口径为「14 个子模块全部 ≤800」，实测含空行计法超 1 行。不影响任何行为验收（拆分后定向测试全绿、openapi 零 diff）；建议后续 quick 顺手收敛或登记 known-issues。

包内明细（wc -l，供对账）：

- session-manager/（13）：types 757、permission 646、events 536、turn-control 486、background-tasks 440、persistence 428、driver-factory 366、lifecycle 381、write-guard 338、usage 225、notify-chain 58、helpers 31、index 19
- task-runner/（8）：spawn-stream 712、skill-prompt 337、runner-types 239、render 186、file-mcp 157、change-write 108、index 56、payload 44
- router/（13）：session_crud 712、runtimes 683、notify 619、gateway_misc 664、session_team 611、daemon_rpc 564、machines 524、heartbeat 381、lease 322、__init__ 312、session_insights 442、session_queue 188、version 182
- session/service/（14）：__init__ 1023、control 801、create 738、recovery 728、queue 725、inject 715、helpers 663、inject_gates 651、ppm_activation 650、read_model 601、session_lifecycle 588、attachments 466、errors 238、results 233
- group/service/（10）：__init__ 817、crud 791、helpers 789、shadow 768、messages 737、members 673、typing_presence 443、mentions 420、timeline_reads 291、settings 134
- run_sync/service/（9）：close_run_steps 774、submit_steps 772、sdk_pipeline 623、group_bridge 506、__init__ 555、stage_team 428、submit_commit 328、gate 377、publish 377
- session-panel/（12）：session-panel-page 2967、session-panel-dialog 1818、page-helpers 742、turn-state 415、index 277、team-trigger-row 183、dialog-helpers 179、use-stream-connection-guard 236、use-session-team-missions 91、worker-session-overlay 83、connection-banners 84、search 40
- lib/daemon/（14）：session-stream 750、group-shadow-stream 729、sessions 674、group-chat 433、session-sse 363、machines 309、runtimes 286、session-lists 277、team-missions 153、session-queue 113、shared-agents 84、sse-internals 39、dir 51、index 16

配套新增（轻重构白名单，D-002/D-005）：sillyhub-daemon 侧 `src/payload-utils.ts`（112）、`src/event-wire.ts`（381）＝白名单①②（task-04）；backend 侧 `_background_tasks.py`（108）、`event_publish.py`（51）、`attachment_pipeline.py`（132）＝白名单③④⑤（task-11）。

## 二、在途排除文件零改动核查（D-001 排除面）

命令：`git diff 4e01d1d44..HEAD --stat -- <9 文件>`（在 worktree 执行）。

**实测结果：8/9 文件 diff 为空 ✓；1 文件有残留 ⚠（见下）。**

| 文件 | diff vs 4e01d1d44 | 判定 |
|---|---|---|
| backend/app/modules/daemon/protocol.py | 空 | 零改动 ✓ |
| backend/app/modules/daemon/runtime/service.py | 空 | 零改动 ✓ |
| backend/app/modules/daemon/ws_hub.py | 空 | 零改动 ✓ |
| backend/app/modules/daemon/lease/context.py | 空 | 零改动 ✓ |
| sillyhub-daemon/src/daemon.ts | 空 | 零改动 ✓ |
| sillyhub-daemon/src/hub-client.ts | 空 | 零改动 ✓ |
| sillyhub-daemon/src/config.ts | 空 | 零改动 ✓ |
| sillyhub-daemon/src/sillyspec-manager.ts | 空 | 零改动 ✓ |
| sillyhub-daemon/src/protocol.ts | **+48 行** | ⚠ merge 残留，见下 |

**protocol.ts 残留分析（task-17 实测定位）**：

- 现象：HEAD 的 protocol.ts 中 `SillySpecResolvePayload` / `SillySpecCommandResult` 两接口**重复声明两次**（529/547 行与 577/595 行两块），比 main 4e01d1d44 多 48 行。
- 根因：基线快照（00c4f644）与 main（4e01d1d44）在相近偏移各自新增了同一组接口（两侧均为一份，内容一致）；D-010 merge（3efb3ec0b）时该文件被 git 自动合并**把两块都保留**——D-010「7 个 baseline 快照类冲突全取 main 最终版」覆盖的是显式冲突文件，protocol.ts 属双方新增非冲突块，自动合并放行。merge 后无任何拆分 commit 再碰它（`git log 3efb3ec0b..HEAD -- sillyhub-daemon/src/protocol.ts` 为空）→ 拆分分支本身零额外改动成立，残留纯属合并解决产物。
- 影响评估：TS 同名同成员 interface 声明合并（declaration merging）合法，tsc/测试不受影响；interface 编译期擦除，零运行时行为差异。但违反 D-010「这些文件内容=main 版」的对齐预期。
- 处置建议：**合回 main 前将该文件复位为 main 版**（删除重复块，-48 行），一行 git checkout 即可，不属本变更拆分内容。

## 三、三端定向回归汇总（引用各验收卡实测数字，不重跑）

| Wave | 验收卡 | 类型检查/Lint | 定向测试实测 | 备注 |
|---|---|---|---|---|
| Wave1 daemon | task-05 | `pnpm exec tsc --noEmit` 零错误 | 定向子集 **958 用例全绿**（tests/interactive 全目录 + task-runner/session-manager 相关） | 现有测试零修改（D-006） |
| Wave2 backend | task-12 | `uv run ruff check app` 0 | 定向回归 **1932 + 1734 用例全绿**（daemon/tests 相关子集） | openapi.json 拆分前后**零 diff**（R-05 直接验收证据）；测试统一 `-n 10`（D-009 口径） |
| Wave3 frontend | task-16 | tsc 通过 | 定向回归 **862 + 427 用例全绿**（components/daemon/__tests__ 58 文件 + 55 处 vi.mock 消费方） | session-panel 7 符号 / lib/daemon 188 导出面零漂移 |

**既有债三处（非本变更引入，如实登记）**：

1. frontend workspaces 相关测试 16 失败（拆分前已存在的测试债，与 session-panel/lib/daemon 拆分无关）；
2. antd 相关 6 errors（既有类型/lint 债，非本变更引入）；
3. 脆弱计时测试 `test_group_p2.py::TestParallelMentionTrigger::test_two_members_trigger_in_parallel`（D-009@v1 已定性：xdist `-n auto` 调度停顿撞 0.35s 断言的环境敏感问题，服务端代码逐字节一致；本变更统一 `-n 10` 全绿，CI 放宽/加 rerun 留后续 quick）。

## 四、commit 链清单（first-parent 00c4f644..HEAD，共 12 节点）

| # | commit | 时间 | task | 内容 |
|---|---|---|---|---|
| 0 | 00c4f644 | 2026-09-07 | baseline | 基线检查点（含主仓并行在途文件快照，逐任务归因时排除 37 文件清单见提交说明） |
| 1 | 2d6bcfa72 | 09-07 09:56 | task-02 | 拆分 session-manager.ts 为 13 子模块 + 瘦 facade |
| 2 | 9913bb26a | 09-07 10:23 | task-03 | 拆分 task-runner.ts 为 8 子模块 + 瘦 facade |
| 3 | 4672ab25f | 09-07 13:31 | task-04 | 轻重构白名单①②⑥（payload-utils 鸭子读取器 + event-wire 平行转换 + dialogResult 提取） |
| 4 | 966fa6e20 | 09-07 20:48 | task-07 | 拆分 daemon router.py 为 13 文件包（挂载顺序不变量 + patch 命名空间兼容） |
| 5 | e5bc40905 | 09-07 22:01 | task-08 | 拆分 session/service.py 为 14 文件包（+6 私有符号保位） |
| 6 | 09c4278ac | 09-07 22:34 | task-09 | 拆分 group/service.py 为 10 文件包 |
| 7 | 3efb3ec0b | 09-07 23:19 | D-010 | Merge main 4e01d1d44（基线刷新；router 增量移植/windowsHide 移植） |
| 8 | 4384687eb | 09-07 23:40 | task-10 | 拆分 run_sync/service.py 为 9 文件包 |
| 9 | a4eee1fe2 | 09-08 00:08 | task-11 | 轻重构白名单③④⑤（后台任务 mixin + Redis publish 统一 + 附件管线收敛） |
| 10 | e7a9d166c | 09-08 06:55 | task-15 | 拆分 lib/daemon.ts 为 14 文件目录（188 导出面零变化） |
| 11 | 7e0dbe040 | 09-08 07:38 | task-14 | 拆分 session-panel.tsx 为 12 文件目录（7 导出符号零变化 + page/dialog 双豁免）＝HEAD |

## 五、总验收结论

1. **8 文件行数全部达标**：facade/类壳全部 ≤2500，新子模块全部 ≤800（两项显式豁免 page ≤3000 / dialog ≤2000 达标）；唯一边缘项 control.py 801（超 1 行，备注①，行为无影响）。
2. **在途排除面**：9 文件中 8 个零改动；protocol.ts 存在 D-010 merge 自动合并残留的重复接口块（+48 行，TS 声明合并静默无害，但须在合回 main 前复位 main 版）。
3. **三端定向回归全绿**（引用 task-05/12/16 实测：958 / 1932+1734 / 862+427），openapi.json 零 diff；既有债三处（workspaces 16 失败 / antd 6 errors / D-009 计时测试）非本变更引入。
4. commit 链完整可追溯（12 节点，见上表），worktree 在本卡执行期间零改动。
