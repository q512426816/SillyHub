---
author: flow-machine-draft
created_at: 2026-10-13T10:43:40.961Z
---
# 任务注册表（Tasks）— 2026-10-13-daemon-turn-anchor-snapshot

- [ ] task-01: 新模块 turn-anchor:recordTurnAnchor(cwd,sessionId,runId,anchorsDir?) 在轮边界对 git 工作区快照(临时 index 复制现场 index→GIT_INDEX_FILE 下 git add -A→write-tree 记 treeSha+HEAD sha),与该会话上一锚 diff-tree -r --numstat 得逐文件 additions/deletions(二进制记 null),追加 JSONL 到 <daemonStateDir>/.runtime/turn-anchors/<sessionId>.jsonl
- [ ] task-02: untracked 新文件必须进锚与 diff(add -A 覆盖,验收:新增未跟踪文件出现在该轮 files)
- [ ] task-03: 零变化轮去重:treeSha 与上一锚相同则 deduped=true 且不追加记录
- [ ] task-04: 失败安全:非 git 目录/git 不可用返回 null 永不抛错,onResult 接线为 fire-and-forget 不阻塞轮结果链路
- [ ] task-05: 同会话并发轮串行化(per-session promise 链),prev 锚优先内存、miss 时读 JSONL 尾行
- [ ] task-06: 单测覆盖:首轮 vs HEAD/增量轮/untracked/二进制 null/去重/非 git 仓 null/JSONL 落盘形态,tests 镜像 src 结构全绿
