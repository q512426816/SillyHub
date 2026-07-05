---
id: task-01
title: "[A1][deploy] docker-compose spec-data named volume 改 bind mount"
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - deploy/docker-compose.yml
  - deploy/.env.example
author: qinyi
created_at: 2026-06-22T21:19:09
---

# task-01: [A1][deploy] docker-compose spec-data named volume 改 bind mount

## 修改文件

- `deploy/docker-compose.yml:55` — `spec-data:/data/spec-workspaces` → `"${SPEC_DATA_HOST_DIR:-C:/data/spec-workspaces}:/data/spec-workspaces"`（由 named volume 改为 bind mount）
- `deploy/docker-compose.yml:110` — 顶级 `volumes:` 下的 `spec-data:` 条目删除（保留 pgdata / redisdata / worktree-data / claude-data）
- `deploy/docker-compose.yml:74` — `SPEC_DATA_ROOT: /data/spec-workspaces` 保持不变（容器内视角路径不变）
- `deploy/.env.example` — 新增 `SPEC_DATA_HOST_DIR=C:/data/spec-workspaces`（含注释：宿主机真实路径，daemon 与容器共享同一物理目录）

## 覆盖来源

- design.md §4.1 A1 路径崩溃（bind mount 共享文件系统）
- design.md §9 兼容策略（D-003@v1 数据可清空，named volume → bind mount 重建）
- requirements.md FR-01

## 实现要求

1. 编辑 `deploy/docker-compose.yml` 第 55 行：把 `- spec-data:/data/spec-workspaces` 改为 `- "${SPEC_DATA_HOST_DIR:-C:/data/spec-workspaces}:/data/spec-workspaces"`。注意保留上一行 worktree-data 与下一行 claude-data 不动。
2. 编辑 `deploy/docker-compose.yml` 顶级 `volumes:` 块（107-112 行附近）：删除 `spec-data:` 这一行。其余四个 named volume（pgdata / redisdata / worktree-data / claude-data）保留。
3. `backend` 服务 `environment` 块（73-74 行）`SPEC_DATA_ROOT: /data/spec-workspaces` **不改**——容器内路径语义不变，backend 仍按 `/data/spec-workspaces/{ws_id}` 拼 spec_root。
4. 在 `deploy/.env.example` 末尾追加一段（建议放在 `# Backend` 段附近，与 backend 相关变量集中）：
   ```
   # spec-workspaces bind mount：宿主机真实路径。daemon（Windows 主机）与
   # backend 容器必须访问同一物理目录，否则 agent 看不到 backend 写入的文档。
   # 默认 C:/data/spec-workspaces（Windows 正斜杠），如权限受限改到用户目录。
   SPEC_DATA_HOST_DIR=C:/data/spec-workspaces
   ```
5. 不修改 `.env`（gitignored 用户实例），仅改 `.env.example` 模板。
6. 提交前运行 `docker compose -f deploy/docker-compose.yml config >/dev/null` 校验 YAML 合法、bind mount 变量插值生效、无悬空的 spec-data 引用。

## 接口定义

- YAML bind mount 语法：`"<HOST_PATH>:<CONTAINER_PATH>"`，左值支持 `${VAR:-default}` 插值（compose 标准行为，读 `.env` 文件）。
- 环境变量：`SPEC_DATA_HOST_DIR`（string，绝对路径，正斜杠分隔），未设置时 compose 用默认 `C:/data/spec-workspaces`。
- 顶级 `volumes:` 块**不再声明** `spec-data`（named volume 不再使用；如保留会变成悬空声明，docker 不报错但语义混乱）。
- 容器内 `/data/spec-workspaces` 路径语义不变：backend `SPEC_DATA_ROOT=/data/spec-workspaces` 保持原值。

## 边界处理（≥5 条，覆盖 null/兼容性/异常/不可变/歧义）

1. **`SPEC_DATA_HOST_DIR` 未设置** — compose `${VAR:-default}` 语法在变量未定义时回落到默认 `C:/data/spec-workspaces`；变量定义为空串（`SPEC_DATA_HOST_DIR=`）时 `${VAR:-default}` 同样回落（`:-` 同时覆盖 undefined 与空串两种 falsy）。
2. **宿主路径不存在** — docker daemon bind mount 时自动创建该目录（以 root 权限）；Windows 下 Docker Desktop 在 WSL2 / Windows 容器层自动建。无需预创建。
3. **既有 named volume 数据迁移（D-003@v1）** — 按 CLAUDE.md 规则7（未上线可清空），切 bind mount 前执行 `docker volume rm multi-agent-platform_spec-data`（或对应 compose project 前缀的 volume 名）清空旧数据；不做数据迁移（YAGNI，未上线）。
4. **Windows 路径正斜杠** — `.env.example` 默认值用 `C:/data/spec-workspaces`（正斜杠）。compose / Docker Desktop 在 Windows 上同时接受 `C:/...` 与 `C:\...`，统一用正斜杠避免 YAML 转义陷阱（反斜杠在双引号字符串中需转义，易错）。
5. **bind mount 权限** — 默认路径 `C:/data/spec-workspaces` 在 C 盘根，Windows 当前用户可写（与 `C:/Users/qinyi/IdeaProjects` 同属可写区）。如遇权限受限，用户改 `.env` 的 `SPEC_DATA_HOST_DIR` 到用户目录（如 `C:/Users/qinyi/spec-workspaces`）。backend 容器以 root 跑，容器内无权限问题；宿主 daemon 进程以当前用户跑，需保证宿主目录当前用户可写。
6. **compose project name 影响 volume 前缀** — compose `name: multi-agent-platform`（compose.yml:3）决定 named volume 实际名前缀；`docker volume rm` 时用 `multi-agent-platform_spec-data`（带前缀），不是裸 `spec-data`。
7. **其他服务不受影响** — postgres / redis / frontend 的 volumes 块不动；只有 backend 服务的 spec-data 挂载点改。

## 非目标

- 不迁移既有 named volume 数据到 bind mount 目录（按 D-003 清空重建）。
- 不改 `worktree-data`（/data/sillyspec-workspaces）——它是 sillyspec worktree 模式的工作目录，本变更不涉及；它仍是 named volume。
- 不改 backend 容器内 `SPEC_DATA_ROOT`（容器视角不变）。
- 不处理 macOS / Linux 宿主机的默认路径（当前仅 Windows 主机场景）。
- 不增加 docker volume 备份/快照机制。

## TDD 步骤

1. **写测试**：在 `deploy/` 下新建（或扩展）compose 校验脚本/测试。如无现成测试框架，写一个 bash 校验脚本（后续 W2 联调 task 会用到）：
   - 用 `docker compose -f deploy/docker-compose.yml config` 导出渲染后的 YAML 到临时文件。
   - 断言 backend 服务的 volumes 含 `"${SPEC_DATA_HOST_DIR:-C:/data/spec-workspaces}:/data/spec-workspaces"`（或渲染后的 `C:/data/spec-workspaces:/data/spec-workspaces`）。
   - 断言顶级 `volumes:` 不含 `spec-data` 键。
   - 断言 backend environment `SPEC_DATA_ROOT=/data/spec-workspaces` 不变。
2. **确认失败**：改 YAML 前运行校验脚本，断言全部失败（当前是 named volume）。
3. **写代码**：按"实现要求"改 `docker-compose.yml` + `.env.example`。
4. **确认通过**：重跑校验脚本，断言全部通过。
5. **回归**：`docker compose config` 整体渲染无错；既有 backend / frontend / postgres / redis 服务定义未被破坏（diff 仅含 spec-data 相关行）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `cd deploy && docker compose config` 渲染整体 YAML | 命令成功退出（exit 0），输出 YAML 合法；backend.volumes 含 `${SPEC_DATA_HOST_DIR:-...}:/data/spec-workspaces` |
| AC-02 | 在 `docker compose config` 输出中查 `volumes:` 顶级块 | 不含 `spec-data` 键；仍含 pgdata / redisdata / worktree-data / claude-data |
| AC-03 | `SPEC_DATA_HOST_DIR=`（空）时跑 `docker compose config` | backend.volumes 渲染为 `C:/data/spec-workspaces:/data/spec-workspaces`（默认值生效） |
| AC-04 | `SPEC_DATA_HOST_DIR=D:/foo` 时跑 `docker compose config` | backend.volumes 渲染为 `D:/foo:/data/spec-workspaces` |
| AC-05 | `docker compose up backend` 启动后容器内 `touch /data/spec-workspaces/_t` | 命令成功，无 EPERM |
| AC-06 | 宿主机查 `C:/data/spec-workspaces/_t`（AC-05 创建的文件） | 文件存在；容器与宿主见同一物理目录 |
| AC-07 | 宿主机 `echo hi > C:/data/spec-workspaces/_h`，容器内 `cat /data/spec-workspaces/_h` | 输出 `hi`；双向读写一致 |
| AC-08 | backend 容器 `env | grep SPEC_DATA_ROOT` | `SPEC_DATA_ROOT=/data/spec-workspaces`（容器内路径未变） |
| AC-09 | `.env.example` 含 `SPEC_DATA_HOST_DIR=C:/data/spec-workspaces` 与注释 | grep 命中；注释说明 daemon 与容器共享 |
