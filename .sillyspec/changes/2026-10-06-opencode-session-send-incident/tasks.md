---
author: flow-machine-draft
created_at: 2026-10-05T23:16:41.772Z
---
# 任务注册表（Tasks）— 2026-10-06-opencode-session-send-incident

> 镜像行（task-01…task-NN）是成功标准逐条镜像=任务锚：勿删勿改写（收口对照它），完成实现路径
> 需要更细步骤时在镜像行**后追加细化行**（保持 `- [ ] task-NN:` 行形态，编号从镜像行末尾顺延——
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决）。
> 边干边勾：完成一条 = 实现到位 + 相关测试跑绿 → 当场勾（sillyspec task tick --change 2026-10-06-opencode-session-send-incident --task task-NN 即时回显进度与下一任务，或 Edit 翻格），勿攒到收口一把勾（收口硬门拒单拍多格勾选；--allow-batch-tick 可显式旁路留痕）。⚠️ harness 的 TodoWrite 类工具不替代本文件——平台进度/收口哨兵只读 tasks.md。
> `flow status --change 2026-10-06-opencode-session-send-incident` 为自愿查看/恢复面。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: isToolReportBody 派生上移到所有早退分支之前（session 判空安全），handleSend 依赖数组补该变量
- [x] task-02: session-panel-pre-session.test.tsx 原先挂掉的 15 个用例全部转绿（TDZ 回归测试即现有用例）
- [x] task-03: 服务器 OpenCode Go 供应商行 extra_env 注入 HTTPS_PROXY=http://127.0.0.1:7897，daemon 本机 Claude Code 经代理连 opencode.ai 实测 200
- [x] task-04: 未跑全量测试（仅跑本修复相关测试文件）
