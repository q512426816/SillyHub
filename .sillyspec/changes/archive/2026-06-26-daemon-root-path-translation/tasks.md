---
author: WhaleFall
created_at: 2026-06-26 12:32:47
change: 2026-06-26-daemon-root-path-translation
---

# Tasks: daemon root_path 翻译修复

> 待 plan 阶段按 Wave 展开。方向与文件清单见 `design.md` §5。

## 预估任务方向（plan 细化）
- [ ] backend：`workspace/service.py` 新增 `resolve_root_path_for_daemon` + 单测
- [ ] backend：`agent/router.py:268` + `placement.py:258,484` + `context_builder.py --dir` 下发点改写
- [ ] daemon：新增 `ensureAllowedRoot` + 在 `task-runner.ts:323` / `daemon.ts:2114` 调用 + 单测
- [ ] 验证：batch + interactive 端到端 + daemon-client 回归 + 裸机兼容
