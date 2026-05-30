---
id: task-06
title: 部署 + 集成验证
priority: P0
estimated_hours: 1
depends_on: [task-04, task-05]
blocks: []
allowed_paths:
  - deploy/
---

# task-06: 部署 + 集成验证

## 修改文件
无代码修改，仅部署和验证操作。

## 实现要求
1. docker compose up -d --build 构建并启动服务
2. 验证后端健康检查通过
3. 触发一个 workspace 的 spec-bootstrap（会启动 Agent run）
4. 在 Agent 运行中，通过浏览器打开 Agent Console 页面
5. 验证日志实时逐行出现
6. 验证 Agent 结束后 SSE 流关闭，完整日志可查

## 验证步骤

1. `cd deploy && docker compose up -d --build`
2. 等待后端就绪：`curl http://localhost:8000/api/health`
3. 登录前端 http://localhost:3000
4. 进入一个 workspace → 触发 Spec Bootstrap
5. 在 Agent Console 页面观察：
   - running 状态下日志实时出现
   - SSE 连接状态指示器（如有的话）
   - Agent 结束后自动切换到 DB 日志视图
6. 打开浏览器 DevTools → Network → EventStream：
   - 看到 `/stream` 请求
   - 看到实时的 data event
   - 看到最终的 done event

## 边界处理
1. 构建失败：检查错误日志，修复后重新构建
2. Agent 未启动：确认 ANTHROPIC_AUTH_TOKEN 配置正确
3. SSE 不工作：检查 Redis 连接（docker compose logs redis）
4. 前端连接 SSE 失败：检查 CORS 配置和 Network 面板

## 非目标
- 不做性能压测
- 不做多实例部署验证
- 不做移动端测试

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | docker compose up --build | 构建成功，4 个容器运行 |
| AC-02 | curl /api/health | 返回 200 |
| AC-03 | 触发 Bootstrap | Agent run 开始，status=running |
| AC-04 | DevTools Network 查看 /stream | SSE 连接建立，收到 data event |
| AC-05 | 日志实时显示 | 每秒内新日志行出现 |
| AC-06 | Agent 结束 | SSE 发送 done，页面显示完整 DB 日志 |
| AC-07 | 全局回归 | 已有功能（workspace、component、change、task）不受影响 |
