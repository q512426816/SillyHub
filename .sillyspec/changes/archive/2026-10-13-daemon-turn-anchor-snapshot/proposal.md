---
author: flow-machine-draft
created_at: 2026-10-13T10:43:40.961Z
---
# 提案书（Proposal）— 2026-10-13-daemon-turn-anchor-snapshot

## 动机

任务原话转写：daemon 轮锚快照最小闭环(轮次文件变化追踪 Route B 真相源,已评审路线图第②步):agent 每轮结束时刻(onResult turn 边界)对会话 cwd 的 git 工作区打内容锚点,逐轮 diff 出真实文件变化,存 daemon 本地 JSONL 供平台后续轮锚对账消费。依据:sillyhub-daemon/src/interactive/session-manager/events.ts onResult(轮边界,state.cwd/sessionId/currentRunId 齐备)、config.ts daemonStateDir()、host-fs-handler.ts execFile git 先例;untracked 由 add -A 天然覆盖(评审 Gap1:stash create 不含未跟踪是雷);锚形态=复制现场 index+add -A+write-tree(stat 缓存保速度,评审定案);tree sha 内容寻址两锚相同=零变化免存储。
成功标准:
- 新模块 turn-anchor:recordTurnAnchor(cwd,sessionId,runId,anchorsDir?) 在轮边界对 git 工作区快照(临时 index 复制现场 index→GIT_INDEX_FILE 下 git add -A→write-tree 记 treeSha+HEAD sha),与该会话上一锚 diff-tree -r --numstat 得逐文件 additions/deletions(二进制记 null),追加 JSONL 到 <daemonStateDir>/.runtime/turn-anchors/<sessionId>.jsonl
- untracked 新文件必须进锚与 diff(add -A 覆盖,验收:新增未跟踪文件出现在该轮 files)
- 零变化轮去重:treeSha 与上一锚相同则 deduped=true 且不追加记录
- 失败安全:非 git 目录/git 不可用返回 null 永不抛错,onResult 接线为 fire-and-forget 不阻塞轮结果链路
- 同会话并发轮串行化(per-session promise 链),prev 锚优先内存、miss 时读 JSONL 尾行
- 单测覆盖:首轮 vs HEAD/增量轮/untracked/二进制 null/去重/非 git 仓 null/JSONL 落盘形态,tests 镜像 src 结构全绿

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. 新模块 turn-anchor:recordTurnAnchor(cwd,sessionId,runId,anchorsDir?) 在轮边界对 git 工作区快照(临时 index 复制现场 index→GIT_INDEX_FILE 下 git add -A→write-tree 记 treeSha+HEAD sha),与该会话上一锚 diff-tree -r --numstat 得逐文件 additions/deletions(二进制记 null),追加 JSONL 到 <daemonStateDir>/.runtime/turn-anchors/<sessionId>.jsonl
2. untracked 新文件必须进锚与 diff(add -A 覆盖,验收:新增未跟踪文件出现在该轮 files)
3. 零变化轮去重:treeSha 与上一锚相同则 deduped=true 且不追加记录
4. 失败安全:非 git 目录/git 不可用返回 null 永不抛错,onResult 接线为 fire-and-forget 不阻塞轮结果链路
5. 同会话并发轮串行化(per-session promise 链),prev 锚优先内存、miss 时读 JSONL 尾行
6. 单测覆盖:首轮 vs HEAD/增量轮/untracked/二进制 null/去重/非 git 仓 null/JSONL 落盘形态,tests 镜像 src 结构全绿

## 成功标准（可验证）

1. 新模块 turn-anchor:recordTurnAnchor(cwd,sessionId,runId,anchorsDir?) 在轮边界对 git 工作区快照(临时 index 复制现场 index→GIT_INDEX_FILE 下 git add -A→write-tree 记 treeSha+HEAD sha),与该会话上一锚 diff-tree -r --numstat 得逐文件 additions/deletions(二进制记 null),追加 JSONL 到 <daemonStateDir>/.runtime/turn-anchors/<sessionId>.jsonl
2. untracked 新文件必须进锚与 diff(add -A 覆盖,验收:新增未跟踪文件出现在该轮 files)
3. 零变化轮去重:treeSha 与上一锚相同则 deduped=true 且不追加记录
4. 失败安全:非 git 目录/git 不可用返回 null 永不抛错,onResult 接线为 fire-and-forget 不阻塞轮结果链路
5. 同会话并发轮串行化(per-session promise 链),prev 锚优先内存、miss 时读 JSONL 尾行
6. 单测覆盖:首轮 vs HEAD/增量轮/untracked/二进制 null/去重/非 git 仓 null/JSONL 落盘形态,tests 镜像 src 结构全绿
