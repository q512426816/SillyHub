---
author: flow-machine-draft
created_at: 2026-09-26T14:45:56.807Z
---
# 任务注册表（Tasks）— 2026-09-26-probe-concurrent-rpc

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [ ] task-01: 批量探测多工作区时 git_probe 并发执行（gather），总耗时逼近最慢一个而非逐个累加
- [ ] task-02: probe_workspace_git_mode 与 git_remote_url 的 RPC 预算收紧为 3 秒，超时仍归 unknown
- [ ] task-03: None（三态语义与 fail-safe 不变）
- [ ] task-04: probe 端点 git_remote_url 的逐工作区读取不再串行追加耗时（未识别的并发预取）
- [ ] task-05: 既有 test_probe_endpoint 全量用例回归全绿，新增并发行为用例（barrier 法证明并发）与超时预算透传用例
- [ ] task-06: 不改任何响应字段口径与既有日志事件语义
