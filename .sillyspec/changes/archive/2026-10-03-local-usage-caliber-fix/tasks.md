---
author: flow-machine-draft
created_at: 2026-10-03T05:43:23.077Z
---
# 任务注册表（Tasks）— 2026-10-03-local-usage-caliber-fix

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge + 2026-09-29 心跳指针）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。📌 任务面在 ①spec 阶段定稿：覆写为真实实现步骤（全 `- [ ]`）后再动代码；执行循环：Working on task N/M → 做一件 → 勾一格 → 下一个——收口硬门拒单拍多格勾选（--allow-batch-tick 可显式旁路留痕）。`flow status --change <名>` 为自愿查看/恢复面（恢复时给下一任务指针与进度，非协议必需——D-007）。本文件收口前随交付显式 pathspec 提交。

- [ ] task-01: 摄取落库口径归一：usage_input_tokens 存「输入−缓存读取」（非缓存输入，与平台 agent_runs 口径对齐），max(0,...) 防负
- [ ] task-02: 注释锚定 113/113 实证
- [ ] task-03: 命中率展示归正：归一后既有公式自动正确（缓存读取/(缓存读取+输入)≈98%）
- [ ] task-04: 本地段参与时间三元组：开始=MIN(first_seen)、结束=MAX(last_seen)、耗时含跨度（ISO 字符串字典序比较）
- [ ] task-05: 混合场景与 run 段取 MIN/MAX、耗时相加
- [ ] task-06: 请求次数：本地段 SUM(invocations) 并入 api_requests
- [ ] task-07: 注脚声明口径（输入=非缓存输入
- [ ] task-08: 时间为上报观察跨度
- [ ] task-09: 请求次数含 CLI 计数）
- [ ] task-10: 轮次维持 0（无来源）
- [ ] task-11: 覆盖写幂等使活跃日志下次上报自动重算
- [ ] task-12: 聚焦测试全绿：test_usage_ingest + test_usage_stats + change-usage-card
