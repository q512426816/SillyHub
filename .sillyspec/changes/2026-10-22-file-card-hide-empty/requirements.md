---
author: flow-machine-draft
created_at: 2026-10-22T00:09:27.498Z
---
# 需求规格（Requirements）— 2026-10-22-file-card-hide-empty

> 用户裁决（原话意译，见 proposal「动机」）：**没有信息就隐藏卡片，顶部汇总也不要留缺口提示**。
> 背景事实：58 轮历史会话的「仅工具编辑」卡来自 daemon 0.2.0 / 平台 10-22 00:43 部署之前跑的轮
> （backend 无 `daemon_run_snapshots` 行 → `capability="tool_only"`），不是 daemon 故障。

## 功能需求

### FR-01: capability=tool_only、快照缺失、status=failed|unavailable 的轮一律不出卡、不出占位（全树不再出现「仅工具编辑」卡）

- 轮级文件变更卡渲染 **必须** 只在「有可信文件清单」时发生；`file_changes_capability="tool_only"`、`file_changes=null`、`status="failed"`、`status="unavailable"` 四种输入 **必须** 一律返回「不出卡」（`null`），**禁止** 渲染「仅工具编辑」降级卡、**禁止** 渲染任何零信息占位块。

#### 场景：历史轮（无快照能力）

Given 一轮的读模型为 `file_changes=null` + `file_changes_capability="tool_only"`；When 会话页渲染该轮；Then 该轮 DOM 中不出现文件变更卡（`data-testid="file-changes-card"` 不存在），也不出现「仅工具编辑」文案。

#### 场景：采集失败（有快照但不可信）

Given 一轮的快照 `status="unavailable"`（git 缺失 / 非 git 仓）或 `status="failed"`；When 渲染该轮；Then 同样不出卡、不出占位（行级数据不可信，静默隐藏而不是显示「daemon 未上报」这种错误归因）。

### FR-02: 有真实文件清单的轮照常出卡：逐文件 +/−、归因、并行会话横幅零变化

- 当快照可信且含至少一条文件行时，轮级卡 **必须** 照常渲染：逐文件 +/− 数字、`edit_patch`/命令归因、`editToolNames`、二进制破折号、`status="partial"` 的截断破折号语义与「共享工作区」横幅 **必须** 与本变更前逐字一致；**禁止** 因本次隐藏策略改动这些既有呈现。

#### 场景：主路径

Given 一轮快照 `status="ok"` 且 `files` 含 2 条（1 条 `edit_patch`、1 条 `command`）；When 渲染该轮；Then 卡片在场、2 条文件行在场、`command` 行标「命令行/脚本改动」、横幅在场。

#### 场景：partial 且无文件清单（保留）

Given 快照 `status="partial"` 且 `files=[]`（1500ms 超时 / 队列溢出）；When 渲染该轮；Then 仍渲染一行提示卡（`data-testid="file-changes-notice"`，「工作区快照未完成…本轮改动未知」）——它携带「本轮采集没完成」的真实信息，不属于本次要隐藏的零信息卡。

### FR-03: 会话级汇总只汇总真实有改动的轮，不再输出「N 轮无工作区快照」缺口提示；零文件时整卡零渲染

- 会话级汇总 **必须** 只聚合「有可信快照」的轮（`snapshot != null` 且 `capability != "tool_only"`），无快照的轮 **禁止** 计入 `degradedTurns`、**禁止** 把汇总状态压到 `partial`、**禁止** 渲染「其中 N 轮无工作区快照（仅工具编辑），汇总不完整」提示行；当聚合后 `totalFiles === 0` 时汇总卡 **必须** 整卡零渲染（不出「共 0 个文件」空壳）。

#### 场景：全历史轮（零文件）

Given 58 轮全部 `file_changes_capability="tool_only"`；When 渲染会话级汇总；Then 汇总卡不渲染（`data-testid="file-changes-summary"` 不存在）。

#### 场景：真实轮 + 历史轮混合

Given 3 轮有可信快照（共 5 个文件）且 55 轮无快照；When 渲染汇总；Then 卡片在场且「共 5 个文件」按真实轮统计，不出现「N 轮无工作区快照」字样。

### FR-04: 全树仍不出现「本轮无改动」字样；file-changes 相关用例按新口径更新后全绿，tsc --noEmit 退出 0

- 隐藏策略 **禁止** 以「本轮无改动」类文案替代（E6/E8 语义红线）：可信快照且 `files=[]` 仍 **必须** 零渲染；`tsc --noEmit` **必须** 退出 0，`file-changes/__tests__` 与轮级挂载用例按新口径更新后 **必须** 全绿。

#### 场景：主路径

Given 变更落盘；When 跑 `tsc --noEmit` 与 `src/components/daemon/file-changes/__tests__/` + `turn-timeline-conversation-file-card.test.tsx`；Then 退出 0 且全绿，任何断言全树不出现 `/无改动/`。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: `frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts`「capability=tool_only → null（不出卡，无『仅工具编辑』）」+「snapshot=null（capability 已给）→ null」+「status=failed / unavailable → null」+ `frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx`「capability="tool_only"（无快照）：整轮不出卡，全树无『仅工具编辑』且无『无改动』」
FR-02: `frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts`「ok + 两条文件（edit_patch / command）→ 卡片 props 逐字段不变」+「partial 且 files=[] → 保留一行提示卡」+ `frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx`（组件级 13 例不回归）
FR-03: `frontend/src/components/daemon/file-changes/__tests__/file-changes-summary.test.tsx`「全为 tool_only → 汇总卡零渲染」+「真实轮 + 无快照轮混合 → 只统计真实轮、无缺口提示行」
FR-04: `frontend/src/components/daemon/file-changes/__tests__/`（4 文件全绿）+ `frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx` + `tsc --noEmit` exit 0
