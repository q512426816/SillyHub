---
author: flow-machine-draft
created_at: 2026-09-30T06:59:16.541Z
---
# 任务注册表（Tasks）— 2026-09-30-takeover-tier3-ambiguous-msg

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge + 2026-09-29 心跳指针）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。📌 任务面在 ①spec 阶段定稿：覆写为真实实现步骤（全 `- [ ]`）后再动代码；执行循环：Working on task N/M → 做一件 → 勾一格 → 下一个——收口硬门拒单拍多格勾选（--allow-batch-tick 可显式旁路留痕）。`flow status --change <名>` 为自愿查看/恢复面（恢复时给下一任务指针与进度，非协议必需——D-007）。本文件收口前随交付显式 pathspec 提交。

- [ ] task-01: takeover ③级歧义时 409 文案包含全部命中机器名（而非「（未知机器）」）
- [ ] task-02: 无命中且无机器身份时文案说明「未识别上报机器」并指引 allowed_roots 配置
- [ ] task-03: 既有 test_takeover.py 用例不回归（ambiguous 用例文案断言更新）
