---
author: qinyi
created_at: 2026-06-09 11:30:00
---

# Requirements：本地守护进程

## 角色

| 角色 | 说明 |
|------|------|
| 开发者 | 在本地机器运行守护进程，执行 Agent 任务 |
| 平台用户 | 通过 Web UI 创建 Agent Run，可选择运行位置（服务器/本地） |
| 管理员 | 管理用户运行时，查看运行时状态 |

## 功能需求

### FR-01：守护进程注册

**Given** 守护进程已安装并配置服务器地址
**When** 守护进程启动（`sillyhub daemon start`）
**Then** 守护进程应成功注册到服务器，返回运行时 ID

**Given** 守护进程已注册
**When** 守护进程重启
**Then** 守护进程应更新运行时状态，复用相同的运行时 ID

### FR-02：任务认领

**Given** 服务器创建了新的 Agent Run（后端选择守护进程执行）
**When** 守护进程收到 WebSocket 唤醒信号（或轮询到 pending 任务）
**Then** 守护进程应通过 HTTP POST 认领任务，获得 claim_token 和执行 payload

**Given** 守护进程认领任务
**When** 另一个守护进程尝试认领同一任务
**Then** 第二个守护进程应收到 409 Conflict 错误

### FR-03：任务执行

**Given** 守护进程已认领任务
**When** 守护进程执行 Agent 子进程
**Then** 守护进程应：
1. 准备本地工作区（镜像工作区 git pull）
2. 渲染 CLAUDE.md 和密钥（从本地 credentials.json）
3. 启动 Claude Code 子进程（stream-json 模式）
4. 实时报告进度（HTTP POST /messages）
5. 完成后上传 patch（HTTP POST /complete）

### FR-04：心跳续期

**Given** 守护进程正在执行任务
**When** 守护进程发送心跳（每 15 秒）
**Then** 服务器应更新 lease_expires_at（延长 60 秒）

**Given** 守护进程执行任务时断线（60 秒无心跳）
**When** lease 过期定时任务触发
**Then** 服务器应：
1. 设置 lease status = 'expired'
2. 触发回退流程：检查 AgentRun 状态，若仍在运行则切换到服务器子进程
3. 增加 attempt_number，超过 3 次则标记失败

### FR-05：进度报告

**Given** 守护进程正在执行任务
**When** Agent 输出日志或工具调用
**Then** 守护进程应通过 HTTP POST /messages 报告到服务器

**Given** 服务器收到守护进程消息
**When** 服务器处理消息
**Then** 服务器应写入 AgentRunLog 并发布 Redis，前端通过 SSE 接收（路径不变）

### FR-06：任务完成

**Given** 守护进程任务完成
**When** 守护进程上传 patch 和统计信息
**Then** 服务器应：
1. 验证 claim_token
2. 应用 patch 到服务器工作区（git apply --check/--3way）
3. 更新 AgentRun 状态
4. 设置 lease status = 'cancelled'
5. 发布 AgentRunCompleted 事件

### FR-07：运行时管理

**Given** 平台用户访问运行时管理页面
**When** 页面加载
**Then** 页面应列出用户的在线运行时，显示名称、Provider、版本、状态、最后心跳时间

**Given** 平台用户在运行时管理页面
**When** 用户点击"设为维护"按钮
**Then** 运行时应进入维护模式，不再认领新任务

### FR-08：运行位置选择

**Given** 平台用户创建 Agent Run
**When** 用户有在线运行时
**Then** 表单应显示单选框：[ ] 服务器 [ ] 本地（运行时名称），默认选择本地

**Given** 平台用户创建 Agent Run
**When** 用户没有在线运行时
**Then** 表单应禁用本地选项，只可选择服务器

### FR-09：优雅降级

**Given** 平台用户选择了本地执行
**When** 守护进程离线（创建任务后）
**Then** 系统应自动回退到服务器执行，用户收到通知

### FR-10：密钥隔离

**Given** 守护进程执行任务
**When** Agent 需要使用 API 密钥
**Then** 密钥应从本地 `~/.sillyhub/daemon/credentials.json` 读取，永不上传服务器

## 非功能需求

- **兼容性**：无守护进程时，Agent 仍在服务器子进程运行，行为不变
- **可回退**：守护进程离线时，任务自动切换到服务器执行，用户无感知
- **可测试**：提供集成测试验证守护进程注册、任务认领、进度报告、任务完成流程
- **幂等性**：重复 claim、重复 complete 应返回相同结果或 409 Conflict
- **安全性**：强制 HTTPS/WSS，密钥本地存储（权限 0600），claim_token 验证
- **性能**：WebSocket 唤醒延迟 < 1 秒，HTTP 心跳超时 60 秒
- **可扩展**：支持多配置文件（`--profile <name>`），同一机器可运行多个守护进程实例
