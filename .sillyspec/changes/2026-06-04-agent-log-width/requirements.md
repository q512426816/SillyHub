---
author: WhaleFall
created_at: 2026-06-04T16:30:00
---

# Requirements

## 角色

| 角色 | 说明 |
|------|------|
| 开发者 | 在 Agent 控制台查看运行日志 |
| 变更负责人 | 在变更详情页查看 Agent 派发日志 |

## 功能需求

### FR-01: 活跃运行日志长行不折行

Given Agent 控制台正在展示某次运行的流式日志  
When 日志行包含超长路径或 JSON  
Then 该行保持单行显示，用户可通过水平滚动查看完整内容

### FR-02: 已完成运行日志长行不折行

Given 用户展开某次已完成运行的内联日志  
When 日志内容超过面板宽度  
Then 使用水平滚动而非 `pre-wrap` 折行

### FR-03: 变更详情 Agent 日志一致

Given 用户在变更详情页展开 Agent 日志  
When 日志行过长  
Then 行为与 FR-01 一致（`whitespace-pre` + 可横向滚动）

## 非功能需求

- 兼容性：不改变日志数据与 SSE 协议
- 可回退：仅前端 class 调整
- 可测试：手动在浏览器验证长行展示
