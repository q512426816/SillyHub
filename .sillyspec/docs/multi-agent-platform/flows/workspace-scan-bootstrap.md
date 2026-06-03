---
author: qinyi
created_at: 2026-06-03T09:50:00
---

# workspace-scan-bootstrap

## 目标
用户导入项目并自动扫描生成 SillySpec 文档架构。

## 参与模块
- **workspace**: 创建/管理工作区，关联 Git 仓库
- **scan_docs**: 扫描项目源码，生成文档树
- **spec_workspace**: 初始化 SillySpec 配置，启动 bootstrap 流程
- **agent**: 调用 Claude Code CLI 执行自动化扫描任务
- **frontend**: 用户界面，展示扫描进度和结果

## 流程摘要
```text
用户点击"导入项目"
  → workspace 创建记录，关联路径
  → scan_docs 检测 .sillyspec 目录
  → spec_workspace 初始化或恢复配置
  → agent 启动 AgentRun（异步）
  → SSE 流推送进度到前端
  → 扫描完成，前端展示文档树
```

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| 项目路径不存在 | 返回 404，前端提示检查路径 |
| AgentRun 启动失败 | 标记状态为 failed，允许重试 |
| SSE 连接断开 | 前端轮询状态恢复 |
