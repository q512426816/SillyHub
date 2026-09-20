---
name: sillyspec:state
description: 查看当前工作状态 — 显示 SillySpec 进度
---

## 流程

跑 `sillyspec progress show [--change <名>]`，把 CLI 输出**原样转述**给用户即可——输出本身已是成品格式（变更/阶段/最近活跃/未决冲突/滞留信号/下一步建议），勿再按自备模板重排。

- 多活跃变更时输出为汇总表；需要单变更细节加 `--change <名>`。
- 输出「没有活跃的变更」时，提示用户：新项目 `/sillyspec:init`、已有项目 `/sillyspec:scan`、恢复中断 `/sillyspec:resume`。

## progress 只读子命令（诊断用）

```bash
sillyspec progress check                   # 状态一致性检查（只报告，不修复）
sillyspec progress repair                  # 修复状态元数据（dry-run，加 --apply 才真改）
sillyspec progress validate                # 校验并修复
sillyspec progress reset [--stage <阶段>]  # 重置进度（破坏性，慎用）
```

- `/sillyspec:status` 看项目整体进度（change 文件级别）；`/sillyspec:state` 看当前工作状态（阶段/步骤级别）——status 看"有什么"，state 看"在做什么"。

## 用户指令
$ARGUMENTS
