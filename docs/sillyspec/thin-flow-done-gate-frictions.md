# thin flow done 三道门与指引口径漂移（活跃坑，待上游修复）

> 来源：2026-09-25-change-detail-assets-usability 全程实测（本机 sillyspec 3.30.0，
> 主仓多会话并行场景）。修复后按惯例移 docs/sillyspec/finished/。
> 上游仓：C:\Users\qinyi\IdeaProjects\sillyspec。

## 复现路径（同一变更被收口门拦了四轮）

1. `flow start` 成功；按其横幅指引「干活时逐条勾选 tasks.md 的 `- [ ]` → `- [x]`」勾完 6 条；
2. `flow done` ❌ 拒收①：`机器段「tasks-rows」内容与指纹失配（被改写）`（artifacts 子步）；
3. 按①的指引跑 `flow amend-draft` 留痕重锚（代价见坑 1）→ `flow done` ❌ 拒收②：
   `design.md 有 1 个空 AGENT 槽（骨架缺失）`——fill 时整文件重写把 `<!--AGENT:槽N-->`
   标记行弄丢了（artifacts 子步）；
4. 手工补回 4 个槽标记 + 6 个绑定标记 → `flow done` ❌ 拒收③：
   `哨兵断言拒收：全勾 6/6 但 6 个任务零完成证据（区间提交无 token）`（ledger 子步）；
5. 把 task-NN token 写进提交**正文**追加 → 仍拒收③（同因，见坑 2）；
6. token 写进提交 **subject** → 过；review 任务书 → 独立子代理出 review.json → PASS →
   归档收口（含 findings 续提交）。

四轮都是「按工具指引/报错文案的合理理解做，仍被下一道门拦」，非实现错误。

## 坑 1：勾选纪律与机器稿指纹门自相矛盾（拒收①）

- 现象：`flow start` 横幅明确要求逐条勾选（并说勾选是哨兵证据面），但 tasks.md 的任务行
  生成时就在 `MACHINE-DRAFT:tasks-rows` 指纹段内（flow-draft.js `draftTasks()` 的
  `wrapped('tasks-rows', rows.join('\n'))`）——勾选态 `- [ ]`→`- [x]` 即改变段内容；
  `verifyMarkers()` 的 `bodyHash` 只做 CRLF 归一的 sha256（machine-draft.js），无勾选态
  归一 → 失配拒收。
- 绕过：`sillyspec flow amend-draft`（工具给的合法留痕通道）。**代价**：amend 把
  勾选态变化计为机器稿改写 → editRatio=1（阈值 0.5）→ `route_hint: thick`
  （「决策覆盖度低，该走厚档」advisory + 遥测记账）——为一次正常操作付出升级提示。
- 建议（两选一）：
  1. 哈希归一化把勾选态抹平：`wrapSection` / `verifyMarkers` / 台账三处同口径地在
     hash 前把 `^([-*] \[)[ xX](?= task-\d)` 归一回 `- [ ]`（勾选本来是预期写面，
     不该参与「被改写」判定）——改动最小，旧台账兼容（draft 全是 `[ ]`）。
  2. 或把 checkbox 行挪出机器段（机器段只留题面/表头），勾选行成为自由书写面。

## 坑 2：哨兵断言只认提交 subject（拒收③，含一轮假绕过）

- 现象：token（task-NN）写在提交**正文**不算证据；`git log --format=%s` 只取 subject
  （flow.js ledger 子步），`detectFakeCheckCompletion` 对 messages 数组做
  `task-NN(?!\d)` 词边界匹配。报错文案只说「提交带 task-NN」，未限定标题行——
  agent 按正文理解重试一次仍被拦。
- 评价：哨兵本身拦得对（我确实没按其证据形态留痕，防「全勾零证据」的假完成）；
  问题只在**判据口径（subject-only）与文案未对齐**。
- 建议：`--format=%s` → `--format=%B`（sentinel 的 messages 按行喂即可，正则逐行匹配
  不受多行影响，改动近一行）；或在报错文案里写明「token 须出现在提交标题行」。

## 坑 3：AGENT 槽标记是「已填」判定的唯一锚点，丢了只有收口才知道（拒收②）

- 现象：用整文件重写方式填槽（Write 全文）会把 `<!--AGENT:槽N …-->` /
  `<!--AGENT:测试绑定FR-NN …-->` / `<!--AGENT:FR区 …-->` 标记行弄丢；收口判定
  `designFilled = matchAll(/<!--AGENT:槽\d+[^\n]*-->\n(\S)/g).length >= 3`
  （flow.js）与绑定标记计数都依赖**标记行存在且下一行非空白** → 报「空 AGENT 槽
  （骨架缺失）」。对 agent 的心智模型：HTML 注释看起来是可丢弃的提示，生成侧注释里
  的「例外裁决书写面」劝说对整文件重写不起作用——守卫只在收口侧炸。
- 绕过：手工把缺失标记行原文补回（flow-draft.js `AGENT_SLOT` / bindingSlot 的生成
  格式），答案紧跟标记行。报错只说「恢复机器骨架后作答」，骨架原文要翻 CLI 源码。
- 建议（任选/叠加）：
  1. 报错时直接打印缺失标记的**原文模板**（机器可生成，零猜测）；
  2. 收口侧对「节标题下已有实质内容但无标记」自动补锚（标记在机器段外，补锚不影响
     机器段指纹）——把「骨架修复」从 agent 手工劳动变成工具自愈；
  3. 或 flow start 横幅与四件套文件头显式加一句「HTML 注释标记是验收锚点，勿删」。

## 坑 4（关联观察）：共享主仓多会话并行下的冻结面归属噪声

- 现象（同变更一次收口中同时出现）：冻结 change.patch 的 20 文件**夹带**了并行会话
  正在写的 `docs/sillyspec/…md`（1 个），同时把本变更 2 个生成物
  （`frontend/src/lib/api-types.ts` / `backend/openapi.json`）按「他侧声明文件」**剔除**；
  ledger 门禁的模块收窄又用到并行会话文件的 diff → `test: skipped`（评测面缺口，
  评审 P2 已留档）。评审后收口提交不在冻结件内——工具无重冻结入口（只有
  `--freeze-dirty` 加法）。
- 绕过：接受缺口（工具三选一之一）；审计真相以 git 提交历史为准，冻结件定位为
  「flow done 时点快照」。
- 建议：会话专属 worktree（工具自荐③）；或提供重冻结入口（按当前 HEAD 重算 +
  重锚 sha256）；或归属按「本会话 flow start 后首个触碰者」记台账。

## 关联留档

- 薄流程 adopt 边界两坑（同期）：docs/sillyspec/thin-flow-adopt-edge-cases.md
- 平台侧变更留档：.sillyspec/changes/archive/2026-09-25-change-detail-assets-usability/
  （review.json 的 5 项非阻断 findings 与本文件坑 4 的 test:skipped 根因互证）
