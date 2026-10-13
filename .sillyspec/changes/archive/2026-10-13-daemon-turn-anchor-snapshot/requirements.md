---
author: flow-machine-draft
created_at: 2026-10-13T10:43:40.961Z
---
# 需求规格（Requirements）— 2026-10-13-daemon-turn-anchor-snapshot

## 功能需求

### FR-01: 新模块 turn-anchor:recordTurnAnchor(cwd,sessionId,runId,anchorsDir?) 在轮边界对 git 工作区快照(临时 index 复制现场 index→GIT_INDEX_FILE 下 git add -A→write-tree 记 treeSha+HEAD sha),与该会话上一锚 diff-tree -r --numstat 得逐文件 additions/deletions(二进制记 null),追加 JSONL 到 <daemonStateDir>/.runtime/turn-anchors/<sessionId>.jsonl

- `recordTurnAnchor` 必须以上述锚形态对 cwd 的 git 工作区打内容锚：复制现场 index 为临时 index（stat 缓存暖场）、`GIT_INDEX_FILE` 下 `git add -A`、`git write-tree` 得 treeSha、`git rev-parse HEAD` 得 headSha（空仓 null）；diff 基线必须取上一锚 treeSha、首轮退 HEAD 树；结果记录必须追加写入 `<daemonStateDir>/.runtime/turn-anchors/<sessionId>.jsonl`（anchorsDir 参数可注入覆盖，测试不落真实用户目录）。

#### 场景：主路径

Given 带一次基线提交的 git 仓、anchorsDir 注入临时目录 / When 首次调用 recordTurnAnchor / Then 返回记录含 treeSha/headSha（hex 形）、prevTreeSha=null、files 含基线→当前的全部变化文件，JSONL 恰好新增一行。

### FR-02: untracked 新文件必须进锚与 diff(add -A 覆盖,验收:新增未跟踪文件出现在该轮 files)

- 快照必须覆盖未跟踪新文件（`git add -A` 天然包含；禁止用不含未跟踪的锚形态如 `git stash create`）；该轮新建的未跟踪文件必须出现在返回记录与 diff 的 files 中。

#### 场景：主路径

Given 基线提交后新建未跟踪文件 new-untracked.ts / When recordTurnAnchor / Then files 含 `{path:'new-untracked.ts', additions:行数, deletions:0}`。

### FR-03: 零变化轮去重:treeSha 与上一锚相同则 deduped=true 且不追加记录

- treeSha 与该会话上一锚相同时，返回记录必须 deduped=true、files 为空数组，且禁止向 JSONL 追加任何行。

#### 场景：主路径

Given 连续两次调用之间工作区零变化 / When 第二次 recordTurnAnchor / Then deduped=true、files=[]、JSONL 行数不变（仍为 1）。

### FR-04: 失败安全:非 git 目录/git 不可用返回 null 永不抛错,onResult 接线为 fire-and-forget 不阻塞轮结果链路

- recordTurnAnchor 在非 git 目录 / git 子命令失败 / 任何 fs 异常时必须返回 null，禁止向调用方抛错；events.ts onResult 的接线必须是 void fire-and-forget（不 await、不在失败时干扰轮结果链路），且不依赖 backend 是否下发 runId（runId 为 null 的锚仍记录）。

#### 场景：主路径

Given 不含 .git 的临时目录 / When recordTurnAnchor / Then 返回 null 且不抛错、不创建任何锚文件。

### FR-05: 同会话并发轮串行化(per-session promise 链),prev 锚优先内存、miss 时读 JSONL 尾行

- 同 sessionId 的并发调用必须经 per-session promise 链串行执行（前一环失败不断链）；上一锚 treeSha 必须优先取模块内存、内存 miss（daemon 重启）时从 JSONL 尾行恢复（坏行向前跳过）。

#### 场景：主路径

Given 已打过一锚后模块状态清零（vi.resetModules 重导入，等价重启）/ When 再打一锚 / Then prevTreeSha 从 JSONL 尾行恢复等于首锚 treeSha，files 只含新增变化。

### FR-06: 单测覆盖:首轮 vs HEAD/增量轮/untracked/二进制 null/去重/非 git 仓 null/JSONL 落盘形态,tests 镜像 src 结构全绿

- `tests/interactive/turn-anchor.test.ts`（镜像 src/interactive/turn-anchor.ts）必须以真实临时 git 仓覆盖：首轮 vs HEAD、增量轮 prevTreeSha 链、untracked 覆盖、二进制 additions/deletions=null、零变化去重不落盘、非 git 仓返回 null、重启续锚（JSONL 尾行）、中文文件名不转义；全部用例必须通过。

#### 场景：主路径

Given 实现与测试就位 / When `pnpm vitest run tests/interactive/turn-anchor.test.ts` / Then 7/7 通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「首轮（有基线提交）：tracked 修改与 untracked 新文件都进 diff；JSONL 落一条；prevTreeSha=null」
FR-02: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「首轮（有基线提交）」内 new-untracked.ts 断言 +「中文文件名：numstat 路径原样 UTF-8」
FR-03: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「零变化轮去重：treeSha 与上一锚相同 → deduped=true 且不追加 JSONL」
FR-04: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「非 git 目录：返回 null 且不抛错（失败安全）」+ events.ts void 接线（typecheck 门）
FR-05: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「重启续锚：模块状态清空后从 JSONL 尾行恢复 prev 锚（内存 miss → 尾行兜底）」+「增量轮：prevTreeSha 链到上一锚，files 只含本轮变化文件」
FR-06: sillyhub-daemon/tests/interactive/turn-anchor.test.ts 全文件 7 用例 + tests/interactive/ 全套 1115 用例（接线回归面）
