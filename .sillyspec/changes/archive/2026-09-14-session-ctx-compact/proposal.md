---
author: qinyi
created_at: 2026-09-14 10:55:00
---
# 提案书（Proposal）

## 动机

会话页上下文环已上线（四引擎真实占用可见），但用户没有任何手段回收上下文——Claude Code CLI 的 /compact 是用户习惯的压缩重置操作，平台缺位导致长会话只能弃用。用户明确要求补齐平台级压缩能力。

## 关键问题

1. **能力缺位**：四引擎中三个有原生压缩通道（claude=slash 文本、pi=RPC compact 命令带结构化回执、codex=thread/compact/start），平台一个都没接；cursor 无通道。
2. **事件现状**：pi 的 compaction_* 事件被归一化器吸收、claude 的 compact_boundary 被白名单丢弃——即便引擎自动压缩发生，平台也毫无感知（v1 不透传，回执走端点响应）。
3. **防遗漏契约**：压缩是典型的引擎差异化能力（3 有 1 无），正是 ProviderCaps 键的适用场景——不接 caps 则未来新引擎又会漏。

## 变更范围

- caps 第 12 键 compact（三端生成+守护，cursor=false）
- backend `POST /sessions/{id}/compact` 双分路端点（claude=inject 复用建 run / pi·codex=ws RPC 等回执）
- daemon `session_compact` RPC handler + session-manager compact 守卫 + pi/codex driver compact 方法（codex 含新 pending 机制）
- 前端环浮层压缩按钮（caps+空闲双门控）+ 三分型结果通知
- 真机三引擎验证

## 不在范围内（显式清单）

- 自动压缩配置管理（NG-01，二期）
- 轮中强制压缩/打断（NG-02）
- cursor 压缩（NG-03）
- 压缩边界事件透传与摘要展示（NG-04）
- 环分子/分母链改动（NG-05）
- 自定义压缩指示输入（NG-06）
- 会话流系统提示行呈现（NG-07，Grill X-f 否决）

## 成功标准（可验证）

- 三引擎真机各压一轮：通知出现（pi 带数字）、claude 会话流出现 /compact 轮、下一轮环回落
- caps 三端一致 + 双守护绿 + 抽键编译红/测试红（防遗漏）
- 前端三分支 vitest（false 不渲染/running 禁用/点击调用）
- 历史会话/旧 daemon/cursor 行为零回归（REST 既有端点零变化）
