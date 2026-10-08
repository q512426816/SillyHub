---
author: flow-machine-draft
created_at: 2026-10-08T02:18:03.314Z
---
# 提案书（Proposal）— 2026-10-08-backend-node22-for-sillyspec332

## 动机

任务原话转写：backend 镜像 Node 20 跑不了 sillyspec 3.32.0——node:sqlite 内置模块需 Node >=22.13（CLI engines 硬要求），容器内任何 sillyspec 命令直接崩，平台技能包（3.32.0 含 flow 协议）与容器 CLI 不配套；把 backend/Dockerfile 的 NODE_VERSION 从 20 升到 22
成功标准：
- backend/Dockerfile NODE_VERSION=22，构建注释说明 sillyspec >=3.30 对 node:sqlite 的依赖
- 重建后容器内 sillyspec --version 为 3.32.0 且 flow 子命令不再报 node:sqlite 崩溃
- 容器内 /app/sillyspec-skills 仍为 21 个技能、/api/health ok
- 不改 apt 包集合与其它层语义

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. backend/Dockerfile NODE_VERSION=22，构建注释说明 sillyspec >=3.30 对 node:sqlite 的依赖
2. 重建后容器内 sillyspec --version 为 3.32.0 且 flow 子命令不再报 node:sqlite 崩溃
3. 容器内 /app/sillyspec-skills 仍为 21 个技能、/api/health ok
4. 不改 apt 包集合与其它层语义

## 成功标准（可验证）

1. backend/Dockerfile NODE_VERSION=22，构建注释说明 sillyspec >=3.30 对 node:sqlite 的依赖
2. 重建后容器内 sillyspec --version 为 3.32.0 且 flow 子命令不再报 node:sqlite 崩溃
3. 容器内 /app/sillyspec-skills 仍为 21 个技能、/api/health ok
4. 不改 apt 包集合与其它层语义
