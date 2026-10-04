---
author: flow-machine-draft
created_at: 2026-10-04T14:02:30.626Z
---
# 任务注册表（Tasks）— 2026-10-04-takeover-tier3-agent-cwd-fallback

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

- [x] task-01: takeover.py 新增 `_latest_agent_cwd` helper（主日志优先、subagent 排除、agent_cwd 空行跳过），`resolve_takeover_machine` 的 tier3 cwd 改为会话行优先 + entry 级回退，409 文案同步用有效 cwd
- [x] task-02: fixture 扩 `session_cwd`/`entry_cwd` 参数（真实 ingest 形态可构造），新增回退命中用例（zcode handoff 档 201）
- [x] task-03: 新增主日志优先用例（更新的 subagent worktree 行不参与匹配）与全空 409 原文案用例（目录「未知」）
- [x] task-04: 跑 `app/modules/daemon/tests/test_takeover.py` 全量（19 用例）绿
