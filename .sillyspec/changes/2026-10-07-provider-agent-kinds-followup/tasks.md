---
author: flow-machine-draft
created_at: 2026-10-06T23:05:38.553Z
---
# 任务注册表（Tasks）— 2026-10-07-provider-agent-kinds-followup

> 镜像行（task-01…task-NN）是成功标准逐条镜像=任务锚：勿删勿改写（收口对照它），完成实现路径
> 需要更细步骤时在镜像行**后追加细化行**（保持 `- [ ] task-NN:` 行形态，编号从镜像行末尾顺延——
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决）。
> 边干边勾：完成一条 = 实现到位 + 相关测试跑绿 → 当场勾（sillyspec task tick --change 2026-10-07-provider-agent-kinds-followup --task task-NN 即时回显进度与下一任务，或 Edit 翻格），勿攒到收口一把勾（收口硬门拒单拍多格勾选；--allow-batch-tick 可显式旁路留痕）。⚠️ harness 的 TodoWrite 类工具不替代本文件——平台进度/收口哨兵只读 tasks.md。
> `flow status --change 2026-10-07-provider-agent-kinds-followup` 为自愿查看/恢复面。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 前端 formToUpdate 产出的 PATCH body 携带 agent_kinds（编辑引擎复选集合真正提交），frontend/src/lib/api/__tests__/llm-providers.test.ts formToUpdate 用例补断言覆盖
- [x] task-02: 后端 LlmProviderUpdate 显式 agent_kinds=null 等同「不动」：openai_chat 行传 null 不抛 TypeError、不写 NULL、集合不变，backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py 补用例覆盖
- [x] task-03: 定向测试绿：后端 llm_provider 域相关测试 + 前端 llm-providers 表单/api 域测试，tsc 与 eslint（改动文件）0 error
- [ ] task-04: 显式 pathspec 提交交付文件（代码+测试+.sillyspec 工件，thin 收口纪律）
