---
author: qinyi
created_at: 2026-08-21T16:45:00
change: 2026-08-21-session-message-queue
---

# 需求清单（Requirements）

## 功能需求

- **FR-01** 输入框始终可用：除 `ended`/`failed`/离线状态外，输入框始终可输入
- **FR-02** 消息排队：running（currentRunId 有值）或 reconnecting 时，用户发送的消息进入前端队列
- **FR-03** 自动投递：`turn_completed` 事件触发 `clearCurrentRun` 后，自动取出队列第一条发送
- **FR-04** active 后投递：session status 从 reconnecting 变为 active 时，自动取出队列第一条发送
- **FR-05** 队列上限：最多排队 5 条消息，超过时输入框显示提示，不接受更多排队
- **FR-06** 失败处理：inject 返回错误时，消息留在队列头部标记 `failed`，用户可重试或删除
- **FR-07** 附件排队：排队条目包含附件 id 引用，发送时一次性携带
- **FR-08** 队列可视化：输入区上方显示排队条目（文本前 40 字 + 附件数），支持删除
- **FR-09** 组件统一：`/sessions` 和 `/runtimes` 页面共享 `SessionPanel` 组件
- **FR-10** 占位文案：running 时 "等待本轮完成，消息将排队…"，reconnecting 时 "会话恢复中，消息将自动发送…"

## 非功能需求

- **NFR-01** 零后端改动：后端 inject 仍检查 `status=active`，前端负责时序
- **NFR-02** 单 tab 内队列：不处理多 tab 同一 session 的竞争
- **NFR-03** 兼容性：兼容 Windows/macOS/Linux，前端样式遵循 AI-Native 双主题系统
