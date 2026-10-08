---
author: flow-machine-draft
created_at: 2026-10-08T02:18:03.314Z
---
# 需求规格（Requirements）— 2026-10-08-backend-node22-for-sillyspec332

## 功能需求

### FR-01: backend/Dockerfile NODE_VERSION=22，构建注释说明 sillyspec >=3.30 对 node:sqlite 的依赖

- 必须：`backend/Dockerfile` 中 `ARG NODE_VERSION` 默认值为 22，且注释含缘由（sillyspec >=3.30 依赖 node:sqlite、engines 要求 Node >=22.13、Node 20 崩溃现象）。

#### 场景：主路径

- Given Dockerfile 原 `ARG NODE_VERSION=20`
- When 改为 22 并附缘由注释
- Then `grep "ARG NODE_VERSION=22" backend/Dockerfile` 命中且其上方注释含 node:sqlite 说明

### FR-02: 重建后容器内 sillyspec --version 为 3.32.0 且 flow 子命令不再报 node:sqlite 崩溃

- 必须：重建 backend 镜像并 --force-recreate 后，容器内 `sillyspec --version` 输出 3.32.0，`sillyspec flow`（或任一需读库的子命令）不再出现 `No such built-in module: node:sqlite`。

#### 场景：主路径

- Given Node 20 镜像内 sillyspec 3.32.0 启动即崩
- When 换 node:22-slim 重建
- Then `sillyspec --version`=3.32.0 且 flow 子命令正常输出（无 ERR_UNKNOWN_BUILTIN_MODULE）

### FR-03: 容器内 /app/sillyspec-skills 仍为 21 个技能、/api/health ok

- 必须：重建后 `ls /app/sillyspec-skills | grep -c '^sillyspec-'` 为 21（含 sillyspec-flow），`/api/health` 返回 status ok。

#### 场景：主路径

- Given 上一变更已把技能刷到 21 个
- When 本变更重建镜像
- Then 技能面不受影响（21 个），服务健康

### FR-04: 不改 apt 包集合与其它层语义

- 禁止：本变更 diff 不得触及 apt 换源/包集合（Dockerfile 78-83 行语义）、venv 构建、daemon 分发 COPY、skills COPY；仅 NODE_VERSION 行及其注释允许变化。

#### 场景：主路径

- Given 上一提交刚稳定 apt 源（sjtu https）
- When 本变更 diff 审查
- Then 仅 NODE_VERSION 常量与注释变化，其余层零 diff

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：Dockerfile 常量改动无单测面，验收以 grep + diff 范围审查为准（design FR-04 场景）
FR-02: 不适用：容器运行时行为，验收以重建后容器内实跑命令为准（成功标准即命令输出）
FR-03: 不适用：容器运行时清点，验收以容器内 ls 计数 + /api/health 实跑为准
FR-04: 不适用：diff 范围约束，验收以 git diff 逐行审查为准
