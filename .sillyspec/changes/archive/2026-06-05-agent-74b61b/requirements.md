---
author: unknown
created_at: 2026-06-05 02:12:00
---

# Requirements: Agent 控制台日志回显宽度调整

## 角色

| 角色 | 说明 |
|---|---|
| 开发者 | 使用 Agent 控制台查看 AI Agent 运行日志的用户 |

## 功能需求

### FR-01: 日志区域宽度自适应

Given Agent 控制台页面加载完成
When 用户在"已完成运行"表格中点击"查看日志"展开日志区域
Then 日志区域宽度应填满 AppShell 主内容区的可用宽度（viewport 减去 sidebar）
And 日志区域不被任何固定最大宽度（如 1152px）截断

### FR-02: 长日志行显示

Given 日志区域已展开
When 日志内容包含超过容器宽度的长文本行
Then 长文本行应自然折行显示（`white-space: pre-wrap; word-break: break-all`）
And 不需要水平滚动即可阅读完整日志内容

### FR-03: 小屏兼容

Given 用户在 1280px 或更小屏幕上访问 Agent 控制台
When 页面加载完成
Then 页面布局正常，内容不溢出
And sidebar 收起（60px）时内容区仍可正常使用

## 非功能需求

- **兼容性**：纯 CSS 类名变更，无浏览器兼容性风险
- **可回退**：恢复 `max-w-6xl mx-auto` 即可回退到原样式
- **可测试**：通过视觉验证确认效果，无需自动化测试
- **性能**：无性能影响，仅为 CSS 类名变更
