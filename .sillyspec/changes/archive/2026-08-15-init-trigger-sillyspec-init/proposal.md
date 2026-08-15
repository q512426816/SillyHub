---
author: qinyi
created_at: 2026-08-15T15:07:51
change: 2026-08-15-init-trigger-sillyspec-init
stage: brainstorm
status: draft
---

# Proposal — init lease 触发 sillyspec init

## 问题陈述

平台工作区"初始化"（init lease）只做文件/HTTP 操作（写状态文件 → pull 文档缓存 → 回灌 → 写 local.yaml），从不执行 `sillyspec init`。成员点击"初始化"后，本地项目目录缺：

1. `.sillyspec-platform.json` 平台指针（init→scan 窗口期裸调 run 命令无法恢复 specRoot）
2. CLAUDE.md / AGENTS.md 等工具指令注入（成员本地 agent 不知道 SillySpec 规范）
3. spec 目录骨架（knowledge/workflows/projects 等，sillyspec 各 stage 依赖的目录结构）

sillyspec CLI 侧平台模式参数（`--workspace-id` / 外部 `--spec-dir` + `writeInitPlatformPointer`）已就绪但无人调用。

## 方案概述

daemon 在 init lease 编排中（pullSpecBundle 之后、postSpecSync 之前）spawn `sillyspec init` 子进程：

- 平台模式参数：`--dir <rootPath> --spec-dir <specCacheRoot> --workspace-id <wsId>`
- `--no-skills`：skills 分发只走 skill-manager（防双渠道漂移）
- `--tool <检测工具>`：daemon agent-detector 检测结果映射 sillyspec VALID_TOOLS
- spawn 前 `sillyspec --version` 门控（防老 CLI 静默忽略新 flag）
- 失败 = lease 硬失败（对齐 D-003 先例）

配套：backend 增量同步 add 同 hash no-op 化（防第二成员骨架文件必冲突）；daemon 三处同步排除 `projects/`（防绝对路径文件上传与误删）；CLI 侧 `--no-skills` + `--tool` 多值 + 平台模式跳过项目内清理（先发版）。

## 不在范围内（Non-Goals）

- 不改 backend lease 契约（mode=init metadata、claim payload 结构）
- 不动 skill-manager 分发链路
- 不动 gate verify 命令白名单
- 不处理扫描/会话流程的 init 需求
- 不做 daemon 通用命令执行框架

## 价值

- 成员本地一次初始化即获得完整 sillyspec 工作环境（指针+指令+骨架），不再依赖 owner 先扫描
- init→scan 窗口期断点消除（platform.json 指针 status:active）
- 修复第二成员加入场景的隐性冲突面（backend no-op 豁免 + projects/ 排除）

## 关联

- 依赖 sillyspec CLI 先发版（--no-skills / --tool 多值 / 平台模式清理跳过）
- 设计细节见 design.md（rev3，经两轮 Design Grill）
