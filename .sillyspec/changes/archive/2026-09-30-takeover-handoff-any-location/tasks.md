---
author: flow-machine-draft
created_at: 2026-09-30T07:27:52.459Z
---
# 任务注册表（Tasks）— 2026-09-30-takeover-handoff-any-location

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge + 2026-09-29 心跳指针）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。📌 任务面在 ①spec 阶段定稿：覆写为真实实现步骤（全 `- [ ]`）后再动代码；执行循环：Working on task N/M → 做一件 → 勾一格 → 下一个——收口硬门拒单拍多格勾选（--allow-batch-tick 可显式旁路留痕）。`flow status --change <名>` 为自愿查看/恢复面（恢复时给下一任务指针与进度，非协议必需——D-007）。本文件收口前随交付显式 pathspec 提交。

- [ ] task-01: handoff 档 TakeoverRequest 支持可选 runtime_id（用户所选机器+引擎），服务端校验属主+在线后用作派发位置
- [ ] task-02: 缺省保持原四级匹配（原机）不回归
- [ ] task-03: handoff 档原机匹配失败不再阻塞（显式 runtime_id 时 handoff_doc=false 降级继续）
- [ ] task-04: 未传 runtime_id 且原机无匹配仍 409
- [ ] task-05: 前端 handoff 档选择器为两级（在线机器 → 该机白名单在线引擎），默认预选上报机器
- [ ] task-06: native 档不渲染选择器且仍锁原机
- [ ] task-07: 接手引擎候选过滤 SESSION_SUPPORTED_PROVIDERS（不可会话引擎不再出现）
- [ ] task-08: 既有 takeover 用例零回归 + 新增覆盖（runtime_id 显式/原机离线降级/白名单过滤）
