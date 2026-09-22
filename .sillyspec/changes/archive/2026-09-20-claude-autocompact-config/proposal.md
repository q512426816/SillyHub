---
author: qinyi
created_at: 2026-09-20 17:19:12
---
# 提案书（Proposal）— claude 引擎 autocompact 配置（provider 级）

## 动机

claude 引擎长会话在 ~160K tokens 触发引擎自动压缩（默认 believed limit 200K × ~80% 设计点），生产会话（6e213eb3，113 轮）频繁被压。平台无干预手段，用户希望按 provider 配置压缩行为（更晚压缩/关闭/预计算）。

## 关键问题

1. 平台管道已有 `settings_config → lease 透传 → claude-settings 白名单 → settings.json` 机制（attribution 等键先例），但白名单不含任何 autocompact 键——配置写了也不生效。
2. 前端 provider 表单无 autocompact 入口，用户只能手改数据库 JSON。
3. window 配置超过模型实际窗口会撞硬限报错而非压缩——需要风险提示承载（用户自担的配置面）。

## 变更范围

- daemon：claude-settings.ts 白名单加三键（值守护：window 正整数/两开关布尔）。
- 前端：llm-provider-form claude 分支「引擎自动压缩」区（三键 + 风险提示）。
- 文档：daemon.md 增量段。

## 不在范围内（显式清单）

- profile 级配置（D-001 否决）
- pi/codex 引擎压缩配置
- 阈值比例可配（SDK 无可写项）

## 成功标准（可验证）

- settings_config 配 `{"autoCompactWindow": 230000}` 的 claude provider 会话，daemon spawn 后 `$CLAUDE_CONFIG_DIR/settings.json` 含该键（单测断言）
- 三键值守护：window=0/负数/非整数、开关非布尔 → 不写入（单测）
- 前端表单 claude 分支渲染三键控件并正确提交进 settings_config；非 claude 不渲染（组件测试）
- 既有 attribution/env 白名单行为零回归（既有用例全绿）
