---
author: flow-machine-draft
created_at: 2026-10-04T14:48:49.718Z
---
# 任务注册表（Tasks）— 2026-10-04-handoff-doc-kind-contract

> 镜像行（task-01…task-NN）是成功标准逐条镜像=任务锚：勿删勿改写（收口对照它），完成实现路径
> 需要更细步骤时在镜像行**后追加细化行**（保持 `- [ ] task-NN:` 行形态，编号从镜像行末尾顺延——
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决）。
> 边干边勾：完成一条 = 实现到位 + 相关测试跑绿 → 当场勾（sillyspec task tick --change 2026-10-04-handoff-doc-kind-contract --task task-NN 即时回显进度与下一任务，或 Edit 翻格），勿攒到收口一把勾（收口硬门拒单拍多格勾选；--allow-batch-tick 可显式旁路留痕）。⚠️ harness 的 TodoWrite 类工具不替代本文件——平台进度/收口哨兵只读 tasks.md。
> `flow status --change 2026-10-04-handoff-doc-kind-contract` 为自愿查看/恢复面。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: build_handoff_prompt 按 kind 五值契约组装：user_input（sender=system_event 跳过）→ 用户行、reply → 助手行（500 截断）、thinking 跳过、tool_use → 操作行+文件提取、tool_result 失败标记回贴配对 tool_use
- [x] task-02: tool_input 兼容 JSON 字符串（含 2KB 截断致 json 解析失败的 regex 兜底）与 dict 双形态，涉及文件节真实数据可产出
- [x] task-03: _build_handoff_first_prompt 的 cwd 会话行优先、空则回退所选 entry 的 agent_cwd（与 tier3 同口径）
- [x] task-04: 测试改用真实契约消息形态，覆盖 system_event 跳过/失败回贴/截断 JSON 兜底/cwd 回退，takeover+handoff 相关测试全绿
