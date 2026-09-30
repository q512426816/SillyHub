---
author: flow-machine-draft
created_at: 2026-09-30T01:36:37.063Z
---
# 任务注册表（Tasks）— 2026-09-30-assets-testfile-nodeid-anchor

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge + 2026-09-29 心跳指针）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。📌 任务面在 ①spec 阶段定稿：覆写为真实实现步骤（全 `- [ ]`）后再动代码；执行循环：Working on task N/M → 做一件 → 勾一格 → 下一个——收口硬门拒单拍多格勾选（--allow-batch-tick 可显式旁路留痕）。`flow status --change <名>` 为自愿查看/恢复面（恢复时给下一任务指针与进度，非协议必需——D-007）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: normalizeTestFilePath 补齐用例锚剥除——「」剥离前置保持，新增取首个锚界符（`::`/`#`/`>`）前路径段 + 剥尾部粘联全角括号注解残段（截断未闭合形与闭合形；半角 `(` 不剥），纯路径输入行为零变化
- [x] task-02: change-assets-card.test.tsx「测试文件路径解析」组新增四用例：`::` 锚（生产实证串）、全角括号残段截断形、闭合形粘联、`#`/`>` 锚——断言搜索入参为剥锚后干净 basename 且弹窗预览真实路径
- [x] task-03: 跑 change-assets-card 测试套件全绿（存量路径解析用例不回退），随后 flow done 收口
