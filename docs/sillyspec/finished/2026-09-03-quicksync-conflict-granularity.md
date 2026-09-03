# quick 会话 spec 同步整树冲突粒度过粗（活跃坑）

- author: qinyi
- created_at: 2026-09-03 06:42:00

## 现象

quick-d6cc113c（ql-20260903-002-cef1）step2 --done 时 spec-sync 报「spec 树冲突」：
164 个 `changes/archive/2026-08-*` 旧归档文件服务器版本领先（他端会话已推进），
要求 `platform resolve <session> --keep-local | --abort` 二选一。

## 为什么是坑

- 冲突文件与本次 quick **零交集**（全是 08-20~08-30 的归档，本会话没碰过）；
  「本地自上次同步未改动而服务器已前进」的文件被并入整树冲突，把会话自己的
  spec 改动（模块文档 + QUICKLOG）本轮同步一并卡死，只能 abort 后等下次重试。
- `--keep-local` 语义危险：会把这些**本地未改动**的文件当成本地意志推上去，
  覆盖服务器新版本（实际上是陈旧副本回推——与启动时「拦下 4 个旧副本回推」
  防护的意图相悖）；用户在两个选项里几乎只能选 abort，等于没有真选择。

## 期望

- 冲突判定按「本会话实际改动的文件」收窄（per-file 冲突而非整树）；
- 或对「本地未改动 + 服务器前进」的文件自动跟随服务器（这些本就不是冲突，
  是正常的多端前进），只对真正双方都改过的文件要求人工裁决。

## 处置记录

- 2026-09-03 06:40 左右选 `--abort`（本地无损失，同步留给下次自动重试），
  会话内 git 提交不受影响。

## 处置记录（2026-09-03 定时收口，已修复）

**根因（复现链澄清）**：三层叠加——① GET 清单 → 全树 hash → POST 的竞态窗（大树 hash 耗时秒级）内他端会话推进服务器，update op 的 base_version 过期 → 服务器按乐观锁回 conflict，与本次会话零交集的 164 个旧归档全部入列；② 防回推的 mtime 启发式（filterStaleUpdates）被 git 操作（pull/checkout/归档重写）刷新 mtime 击穿——内容未变的旧文件伪装成「刚改过」，重试路径会把陈旧副本静默推上服务器（回退）；③ 整批 conflict 坐实 spec-sync-conflict 文件 → 进 resolve 人工流程，`--keep-local` 又会回推陈旧副本，用户只剩 abort。

**修复（sillyspec 仓 `src/spec-sync.js` + `src/sync.js`，工作区未提交）**：
1. **内容基线快照**（`.runtime/spec-sync-base.json` = 上次成功同步时的本地 hash 全集）：「本地未改动」改为内容级判据，免疫 mtime 伪造——内容没变就是没改，服务器前进属正常多端演进。
2. **pre-POST follower 丢弃**（`dropFollowServerUpdates`）：本地 hash == 基线 → update op 发出前即丢弃（跟随服务器），事故形态（他端推进 + 本地 mtime 被刷新）重演时零冲突零回推。mtime 启发式保留兜底快照缺失的过渡期。
3. **冲突粒度收窄**（`partitionConflictPaths`）：服务器 conflict 回告按「本地是否真改动」分流——follower 自动跟随（不进冲突文件、全 follower 时本轮视为成功并写基线，服务器「冲突跳过其余照常 apply」语义下本会话改动已落）；只有本地真改动文件进冲突文件（新增 `auto_followed` 留痕）。
4. **keep-local 强制旁路**（`syncSpecTree` 新增 `forcePush`，resolve --keep-local 传入）：用户显式裁决「以本地为准」时本地意志高于跟随语义，防回推过滤全旁路——强制重推不被削掉。

**出口契约变更（注意）**：「重存/touch 后重推」不再是强制出口（内容级判据下无意义）；确需以本地为准 = 真实改动内容，或 `platform resolve <change> --keep-local`。

**测试证据**：新增 `test/quicksync-conflict-granularity.test.mjs` 5 用例全绿（dropFollowServerUpdates/partitionConflictPaths 单元 ×2、事故复现链闭环 e2e——首同步建基线→他端推进+mtime 刷新→follower 不回推不冲突、竞态冲突自动消解 e2e、真冲突粒度收窄 e2e）；既有 hub08-spec-sync-conflict / platform-spec-sync-incremental 两处按新契约适配（复现冲突需真实改动；touch 不再放行、真实改动放行）；受影响面 65 用例全过。

**遗留**：平台侧无改动需求（服务器「冲突跳过、其余照常 apply」语义正确，粒度问题在客户端判定）；`platform resolve` 单轮只消一类冲突的 UX 项已在 agent-collab 清单留档，不属本坑。
