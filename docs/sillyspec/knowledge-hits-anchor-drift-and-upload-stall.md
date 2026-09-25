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
