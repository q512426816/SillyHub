---
author: WhaleFall
created_at: 2026-06-04T07:22:12.106630
---

# Proposal: 调整 Agent 控制台查看日志的回显宽度

## 动机

工具调用与命令输出常含长路径、长 JSON；当前日志区强制折行，难以对照原始内容。

## 关键问题

1. 活跃日志使用 `break-all`，在任意字符处断行，破坏路径与 token 连续性。
2. 已完成日志 `pre` 使用 `whitespace-pre-wrap`，在容器宽度处换行，长行不可横向扫读。
3. 变更详情页 Agent 日志使用相同折行策略，体验不一致。

## 变更范围

- Agent 页（`/workspaces/[id]/agent`）活跃与已完成日志展示样式
- 变更详情页（`/workspaces/[id]/changes/[cid]`）Agent 日志展示样式

## 不在范围内（显式清单）

- 修改日志采集、脱敏或 SSE 推送逻辑
- 调整其他模块（bootstrap、runtime、knowledge）的 `pre-wrap` 区域
- 变更 brainstorm 无人值守流程（单独在 `brainstorm.md` prompt 中修复）

## 成功标准（可验证）

- 长日志行在 Agent 控制台与变更详情页可水平滚动查看完整内容
- 短行展示与改前一致，垂直滚动仍正常
- 无新增控制台报错
