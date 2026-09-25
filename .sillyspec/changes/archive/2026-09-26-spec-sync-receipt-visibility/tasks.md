---
author: flow-machine-draft
created_at: 2026-09-25T16:20:13.221Z
---
# 任务注册表（Tasks）— 2026-09-26-spec-sync-receipt-visibility

> 机器稿（成功标准机械推导）；轻量跑直写=零任务卡（任务即 checkbox 行）；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

- [ ] task-01: 全量同步回执（SpecSyncResponse）增 landed_files
- [ ] task-02: skipped_files 计数
- [ ] task-03: skipped>0 时服务端显式 warn 日志（跳过原因计入：墓碑前缀排除 + staging 成员缺失）
- [ ] task-04: 增量同步回执（SpecIncrementalSyncResponse）增 applied_ops / skipped_conflict / skipped_to…
- [ ] task-05: 增量冲突发生时写 SpecConflict 注册表行（stage=spec-sync…
- [ ] task-06: 同工作区同 stage 开放行幂等更新不重复建行），随后一次全绿同步自动把开放冲突行置 resolved（闭环不留僵尸）
- [ ] task-07: 前端工作区布局挂 spec 同步冲突横幅：有开放 spec-sync 冲突时显示细条警示（数量 + 「镜像可能滞后」提示），无冲突不渲染
- [ ] task-08: gen:types 契约同步（api-types.ts + openapi.json 随提交）
- [ ] task-09: 后端单测：墓碑前缀跳过计数 / 冲突建行 + 成功闭环 / 计数字段在两回执中
- [ ] task-10: 前端横幅渲染
- [ ] task-11: 隐藏用例
- [ ] task-12: 既有 spec_workspace 测试与前端布局相关测试零回归
