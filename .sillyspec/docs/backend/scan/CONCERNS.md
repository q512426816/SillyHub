---
author: qinyi
created_at: 2026-05-29T17:42:00
---

# CONCERNS — backend

## 严重

- **OpenTelemetry 为 stub**：`app/core/telemetry.py` 仅打印配置状态，无实际导出器。生产环境无分布式追踪能力。
- **Docker 路径映射手动配置**：`host_path_prefix` + `container_path_prefix` 需要运维手动设置，容易出错。

## 中等

- **spec_profile 模块 5 个 TODO**：冲突检测（policy.py:61, policy.py:97）和发现逻辑（provider.py:77, 87, 97）未实现。
- **Agent 适配器通过子进程调用 Claude CLI**：进程管理、超时、资源清理需要额外的健壮性保障。
- **Git 命令通过子进程执行**：Windows 兼容性可能有边缘问题（路径分隔符、权限）。
- ** AccessTokenError 和 GitCommandError 不继承 AppError**：异常层次结构不统一，可能绕过全局异常处理器。

## 低

- **测试覆盖率门槛仅 60%**：部分模块可能有未测试的代码路径。
- **pyproject.toml 中无显式 --cov 配置**：覆盖率参数依赖 Makefile 命令行传入。
