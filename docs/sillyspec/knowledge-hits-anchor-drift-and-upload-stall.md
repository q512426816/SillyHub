---
title: 知识命中遥测的锚点三代漂移 + hits.jsonl 被 merge 清空后上行卡死（平台「知识命中很局限」归因）
date: 2026-09-25
status: 活跃（工具侧待修；平台侧口径问题同批列出，归本仓 backlog）
source: 生产工作区 c84182bc-5db4-4441-98b6-eee4903cd7d9（sillyspec CLI 仓前置 spec）知识页/扫描文档页命中与覆盖异常调查——2026-09-25
---

# 知识命中遥测：锚点三代漂移 + 上行卡死

> 一句话守则：**平台知识页的「命中/覆盖」= 平台按当前知识文件标题现算的锚点（`slugify_anchor`）
> 与 CLI 写进 hits `matchedFiles` 的锚点（INDEX 路由行原样）做字符串精确匹配。
> 只要 CLI 侧 INDEX 锚点生成规则、或标题本身，与平台侧 slug 规则不一致，
> 命中就会被判成「幽灵锚」——不计覆盖、不计死条目清理依据，页面只剩榜单上几行。
> 改任一侧规则前，先跑双端锚点交叉断言（把两边规则的真值表钉成测试）。**

## 现象（2026-09-25 生产实证）

工作区 `c84182bc-…` 知识页：覆盖率 311/1758（17.7%）、死条目 1447、使用率榜仅 72 行，
其中 `decisions/*`、`fr/*` 各只有 8~11 行「整文件」行；扫描文档页注入统计 30 天仅 20 行 / 8 个文档。

本地复算（拉平台镜像 67 个知识文件 + 3389 行 hits = `.pre-merge-backup-2026-09-24T0620/.runtime/knowledge-hits.jsonl`）
逐字复现了 1758 / 311 / 1447 三个数字 → **聚合算法本身没算错，错在输入与匹配口径**。

## 证据链

1. **72 个命中锚点里只有 6 个能在平台镜像的知识树里找到对应条目**（另 66 个是幽灵锚）：
   - 53 个手册锚点（known-issues 29 / conventions 14 / patterns 10）**交集为 0**。命中侧是 CLI 时代
     的手册小节（锚点形如 `known-issues.md#Windows 下 process.exit 触发 UV_HANDLE_CLOSING assertion 覆盖退出码`，
     即**标题原文**），镜像里的手册已被合并后的另一代内容替换（emoji 前缀小节）。
   - 13 个文件级锚点（`decisions/worktree.md`、`decisions/setup.md`、`fr/sync.md` …）指向的文件
     **在镜像里不存在**，但本地树与 daemon 的本地 manifest 里都有 → 镜像 / manifest / 本地树三份快照互不一致。
2. **锚点生成规则目前仍有 3 套并存**（同一标题产出 3 个不同锚点）：
   | 标题 | CLI `stages/knowledge.js` slug | INDEX 路由行实际锚点 | 平台 `slugify_anchor` |
   |---|---|---|---|
   | `🟡 sillyhub-daemon 于 2026-06-14 从 Python 重写为 Node.js` | `sillyhub-daemon-…-node-js` | `sillyhub-daemon-…-nodejs`（无前导 `-`） | `-sillyhub-daemon-…-nodejs`（emoji 去掉但空格转的 `-` 留首） |
   | `子项目构建 / 测试 / lint 命令` | `子项目构建-测试-lint-命令` | `子项目构建--测试--lint-命令` | `子项目构建--测试--lint-命令` |
   | `…硬钉 0.3.181` | 同左（`.`→`-`） | 保留 `0.3.181` | 丢点 → `03181` |
   结论：**标题带 emoji 前缀 / 保留点号 / 标题事后被改**三类，命中必落空。
   当前一代 INDEX 58 条带锚点路由行里就有 6 条立刻是幽灵锚（≈10%，全在 known-issues.md）。
3. **hits.jsonl 被 merge 清空后上行卡死**：daemon 状态文件
   `~/.sillyhub/daemon/.hits-upload-state-c84182bc-….json` = `uploadedLines: 3389`（2026-09-24T00:46Z），
   而当前 `.runtime/knowledge-hits.jsonl` 只有 9 行（2026-09-24 13:59Z 起）。
   merge 把文件从 3389 行重置为空 → 平台最新命中停在 2026-09-23T19:49Z，此后新命中一行都没上行。
   包内虽有钳位代码（`uploadedLines > completeLines.length` → 钳位并固化），但该工作区自
   2026-09-23 16:41 起 spec 推送上行持续失败（`SpecPushConflict`），钩子从未跑到 → 钳位没机会执行。
4. **条目级命中粒度缺失**：`decisions/`、`fr/` 的 INDEX 路由行是「一个文件一行」（无锚点），
   命中即整文件 → 平台只能把整文件所有 `##` 条目算作「被用过」。
   覆盖数 311 = fr 156 + decisions 155 + 顶层手册 0 —— 「知识手册 0 命中」正由证据 1 造成。
5. **分母含结构性不可达桶**：`fr/unmapped.md` 713 条（3389 行 hits 里出现次数 = 0）、
   `decisions/unmapped.md` 148 条、`uncategorized.md` 39 条，加上「文件级命中被当作整文件条目」
   的口径二分，使覆盖率与死条目两个指标同时失真。

## 工具侧修复建议（sillyspec CLI / daemon）

- T1 `hits.jsonl` 属历史遥测：merge / 重置 / 清理 spec 时不得清空，应轮转归档；daemon 侧
  offset 从「行数」升级为「前 N 行指纹（行数 + 尾行哈希）」，文件被替换即自动从头重报
  （服务端 `(workspace_id, line_hash)` 已幂等兜底，重报零风险）。
- T2 锚点规则单一源：INDEX 写侧与平台读侧共用同一份 slug 规范（emoji 前缀、点号、斜杠、
  大小写、截断 60、首尾 `-`），并用交叉真值表测试钉住；或干脆弃用「标题 slug」改用稳定条目 ID。
- T3 decisions/fr 命中落「条目级」：注入时 CLI 已解析出具体 `D-xxx@vN` / `FR-域-NNN`，
  写进 matchedFiles（或新增字段），平台才能算条目级使用率，而不是「文件被用过一次 = 整文件算用过」。
- T4 路由行锚点与标题的一致性校验进 `sillyspec knowledge validate`（标题改了但路由行没跟 → 报 warning），
  避免「INDEX 锚点 / 文件标题」静默漂移。

## 根因定性（2026-09-25 追加）：9-24 的 knowledge 合并把 CLI 侧知识面换成了平台侧

sillyspec 仓提交 `80355e9b`（2026-09-24 `docs(knowledge): 合回知识面（… spec 归位主仓）`）
把**平台侧知识整体覆盖进 CLI 仓的 knowledge/**：

- `conventions.md`：19 条 CLI 自有小节（ESM Only / Naming / Error Handling / Logging /
  CLI Entry / Zero Config Init / 铁律段格式 / 资产保护注释 / …）→ 11 条平台小节
  （SillySpec 文档驱动开发流程 / backend Python 工程约定 / 前端 SSE 消费 …）；
- `known-issues.md`：40 条 → 25 条（CLI 自有坑条目被删）；
- 新增平台侧 `decisions/*`（backend +339 / frontend +297 / unmapped +1232 行 …）与
  `fr/*`（auto-backend / cli / daemon / lib-* …），`INDEX.md` 重写 +219 行。

而 3389 行命中遥测全部产生于合并前（2026-09-14 ~ 09-23）的 CLI 自有知识面。
于是页面的分母（当前镜像 = 平台侧知识 1758 条）与命中记录（CLI 侧知识）**几乎不相交**：

| 命中归属 | 次数 | 占比 |
|---|---|---|
| 手册三文件小节（锚点对不上 + 内容已被换掉） | 7136 | 66% |
| 页面文件清单里不存在的 13 个 CLI 域文件 | 2707 | 25% |
| **真正能落到页面可见条目的**（decisions/runtime 325 + fr/core-engine 222 + fr/runtime 193 + decisions/unmapped 112 + fr/setup 78 + fr/cli-entry 19） | **949** | **8.8%** |

即：**页面 17.7% 的覆盖率，是「拿平台的知识当分母、去匹配 CLI 的命中记录」的残值**，
既不反映 CLI 侧知识使用率，也不反映平台侧。度量口径必须先修好这一层，再谈覆盖率数字。

## 本地文件对账（一切以本地为准，2026-09-25）

两仓本地知识树 × 本地 hits（平台同口径复算）vs 页面实际：

| 指标 | sillyspec 仓（页 c84182bc） | multi-agent-platform 仓（页 b97f8231） |
|---|---|---|
| 本地知识文件 | 86（含 6 proposed） | 102（含 40 generated + INDEX） |
| **页面清单** | **67 → 缺 19**（13 个 decisions/fr + 6 proposed） | **61 → 缺 41**（整个 generated/ 40 个 + INDEX） |
| 本地条目 | 1962 | 1649 |
| 页面条目 | 1758（13 文件少 170 条 + decisions/runtime 41→7） | 1558 |
| 本地口径覆盖率 | **554/1962 = 28.2%**（死 1408） | **310/1649 = 18.8%**（死 1339） |
| 页面覆盖率 | 311/1758 = 17.7%（死 1447） | 195/1558 = 12.5%（死 1363） |
| 本地 hits | 3398 行（3389 备份 + 9 现行）/ 10829 次 | 3760 行 / 28467 次 |
| 命中无法归属本地 | 55 锚点 / **7138 次 = 65.9%**（9-24 合并删掉的自有 handbook 小节） | 6 锚点 / **3597 次 = 12.6%**（emoji 前缀 / 点号 / 标题漂移） |

本仓（平台）自身的 6 条活性漂移（本地 INDEX 写的锚点 vs 本地文件标题算出的锚点，命中次数为本地 hits 实测）：

| INDEX 写的锚点 | 本地文件算出的锚点 | 命中 |
|---|---|---|
| `known-issues.md#sillyhub-daemon-于-2026-06-14-从-python-重写为-nodejs` | `…#-sillyhub-daemon-…`（emoji 去掉后空格转的 `-` 留在首） | 890 |
| `known-issues.md#本机可能存在多个-daemon-实例` | `…#-本机可能存在多个-daemon-实例` | 889 |
| `known-issues.md#agentrunlog-无-metadata-列三层日志-metadata-丢失` | `…#-agentrunlog-无-metadata-列--三层日志-metadata-丢失`（斜杠处 `-` 差异） | 321 |
| `known-issues.md#ci-hook-复合命令可绕过-claude-pretooluse-层` | `…#-ci-hook-复合命令可绕过-claude-pretooluse-层` | 4 |
| `…#-daemon-pnpm-overrides-把-claude-agent-sdk-8-平台二进制硬钉-0.3.181` | `…#…硬钉-03181`（点号被丢） | 1130 |
| `…#-全-docker-部署本地-pg-容器端口未映射-hostrun-alembicpytest-连不上` | `…#…未映射-hosthost-跑-alembicpytest-连不上`（逗号/斜杠规则不同 + 标题漂移） | 363 |

CLI 仓自有知识面本地可恢复：`.sillyspec/.pre-merge-backup-2026-09-24T0620/knowledge/`
（`conventions.md` 19 条 CLI 小节 / `known-issues.md` 40 条 / CLI `patterns.md`）+
同目录 `.runtime/knowledge-hits.jsonl`（3389 行，即页面数据源）。

**验收标准（以本地文件为准）**：修完后逐文件对账三项全等——① 知识文件清单；
② 每文件条目数；③ 文件级命中数（`use_count` / `entry_counts`）。

## 平台侧配套（本仓 backlog，非工具缺陷）

- P1 覆盖率分母分层：只统计「可路由条目」（INDEX 路由面 ∪ 文件级可命中文件），或按 zone
  （手册 / decisions / fr）分会话展示；`unmapped` / `uncategorized` / `proposed` 等结构性不可达桶单列。
- P2 匹配容错：锚点比对前做归一（emoji、首尾 `-`、`·`/`.`、大小写），并把「历史命中但当前树无对应条目」
  单列一个「已失效命中」分组，而不是静默留在榜单上。
- P3 `GET /knowledge/stats` 增加数据截止时间（max `last_hit` / max `received_at`），前端标注「截至 X」。
- P4 scan-docs：`module_have` 需排除 `*.changelog.md` 等非模块文档（当前出现 245/240 = 120% 覆盖率）；
  陈旧 / 新鲜改用 `source_mtime` + 内容 hash，而不是被同步重写过的镜像 mtime（合并当天全量 304/304「新鲜」）。
- P5 spec-sync 快照一致性：工作区 `c84182bc` 的**镜像（67 个知识文件）**、**daemon 本地 manifest
  （30 个，含镜像里没有的 13 个 decisions/fr 文件与 6 个 proposed）**、**本地树（86 个）** 三份互不一致；
  该工作区 spec 推送上行自 2026-09-23 16:41 起持续 `SpecPushConflict` 失败，另一工作区
  `b97f8231`（本仓）另有 `HTTP 413` 失败记录（daemon.log）→ 需排查增量推送冲突与超限后的
  镜像落地语义（是否部分落地 / manifest 是否按落地结果回写）。

## 复算方法（本地可重跑）

```bash
# 1) 拉平台镜像知识树（只读，用 daemon runtime key 走 X-API-Key）
#    GET /api/workspaces/{ws}/knowledge  +  GET /api/workspaces/{ws}/knowledge/{filename:path}
# 2) 用本仓 parser 现算条目全集与锚点
python -c "import sys;sys.path.insert(0,'backend');from pathlib import Path;from app.modules.knowledge.parser import parse_knowledge_entries as p;print(len(p(Path('.sillyspec'))))"
# 3) 与 hits 锚点求交（hits 行 = .runtime/knowledge-hits.jsonl 或 .pre-merge-backup-*）
```
