---
author: qinyi
created_at: 2026-08-18 13:45:00
---

# quick 会话完成后不触发任何平台同步（进度 / 文档 / spec 树全静默）

## 现象

`sillyspec run quick --done --change quick-<id>` 完成后，平台（SillyHub）侧什么都没收到：
QUICKLOG、模块文档等 spec 树文件不更新，进度也不上行。输出里没有任何 `[sync]` /
`[spec-sync]` 日志（连"未连接平台"或"变更不存在"的 warn 都没有）。

实测：2026-08-18 ql-20260818-009-c287（multi-agent-platform，local.yaml platform 段配置
完好，url=127.0.0.1:8001 + shpsync_ token，CLI 3.26.10 带 spec-sync 功能）。

## 根因（sillyspec 仓源码，两层门叠加）

quick 会话按设计**没有** `.sillyspec/changes/<changeName>/` 目录（changeName =
`quick-<hex8>` 会话 ID），而平台同步链的每一环都锚定「变更目录存在」：

1. `src/run/shared.js` `triggerSync()`（:424）：
   `if (changeName && !existsSync(join(cwd, '.sillyspec', 'changes', changeName))) return`
   —— quick-<id> 不存在 → **静默 return**（无任何日志，所以表面看像"没触发"）。
2. 即使过了第一道，`src/sync.js` `SyncManager.sync()`（:385-389）还有第二道同款
   existsSync 门 → `[sync] 变更不存在: quick-<id>` → return `{synced: 0}`。

而 2026-08-17 落的 spec 树增量同步（`syncSpecTree`）挂在 sync() 成功**之后**
（sync.js:475），四件套文档直推（`syncDocuments`）同理（sync.js:466）——整条链
（进度 → 文档 → spec 树）全部 unreachable。

## 影响

- 所有 quick 会话（不只本次）的产出（QUICKLOG 条目、模块文档修订、活跃变更文件）
  永不自动上行平台；变更中心文件树/知识库视图滞后，直到下次任意**完整变更**的
  `--done` 触发 syncSpecTree 全树 diff 才被顺带推上去。
- `--linked-changes` 关联的变更也不因此上行——triggerSync 传的仍是 quick-<id>。

## 合理性辨析（修复时的语义边界）

对 quick 而言三段上行的意义不同：

- **进度上行（progress）**：quick-<id> 在平台无对应变更目录，推上去是孤儿行
  （变更中心按磁盘 change_key join，永不命中）→ 跳过是**对的**。
- **四件套文档（syncDocuments）**：quick 无 changes/<name>/ 四件套 → 跳过是**对的**。
- **spec 树增量（syncSpecTree）**：以服务器清单为锚做全树 diff，与变更目录无关，
  QUICKLOG/模块文档正是靠它上行 → **这段被误伤，是真正要接上的**。

## 修复记录（sillyspec 仓 22d80aa，ql-20260818-011-9ae6）

- **修复提交**：`22d80aa fix(quick): quick 会话补平台 spec 树同步`
- **涉及文件**：
  - `src/run/shared.js`：`triggerSync()` 识别 `quick-<hex8>` 模式；变更目录不存在时不再静默 return，降级调用 `syncSpecTreeOnly(changeName, cwd)`。真实变更名拼写错误仍保持静默（不引入噪音）。
  - `src/sync.js`：新增导出 `syncSpecTreeOnly(changeName, cwd)`，跳过 progress 和四件套文档，只走 spec 树增量同步。
  - `test/platform-sync-quick-session-spectree.test.mjs`：4 组验收——已连接平台推 spec 树、未连接平台静默、真实变更目录走原路径不变、拼写错误保持静默。
  - `docs/sillyspec/platform-interface-map.md`：同步重锚 `triggerSync:425`、熔断范围 `420-432`。
- **升级主仓 CLI**：全局安装从本地 sillyspec 仓库重新安装（`npm install -g C:/Users/qinyi/IdeaProjects/sillyspec`）→ `sillyspec --version` 升到 >=3.26.11（含本次修复）。

## 绕过方案（历史，已修复）

~~quick 完成后手动触发一次全树同步：起一个活跃完整变更跑任意 `--done`，或
`sillyspec platform sync`（若可用）。~~ 修复后 quick `--done` 自动触发 `[spec-sync]`。