---
author: flow-machine-draft
created_at: 2026-09-25T12:38:54.863Z
---
# 任务注册表（Tasks）— 2026-09-25-full-sync-resurrect-missing

> 机器稿（成功标准机械推导）；轻量跑直写=零任务卡（任务即 checkbox 行）；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

- [x] task-01: 同内容跳过分支增加「磁盘已有该文件且行在线（exists=True）」前提
- [x] task-02: 磁盘缺失或行软删时按复活语义落盘（move 文件 + 行翻回 exists=True），不再要求 mtime 更新才写
- [x] task-03: 复活时内容一致的文件不产生冲突归档行（内容相同无冲突可言）
- [x] task-04: 内容不同仍走既有冲突归档
- [x] task-05: 新增单测：①幽灵软删行（exists=False 且哈希相同）+ 磁盘缺文件 → 落盘且行翻回在线
- [x] task-06: ②磁盘缺文件但哈希相同（行在线）→ 落盘
- [x] task-07: ③正常「哈希相同且磁盘已有」仍跳过（零回归钉死）
- [x] task-08: 既有 spec_workspace 全量同步测试零回归
