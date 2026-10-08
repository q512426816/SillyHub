---
author: flow-machine-draft
created_at: 2026-10-08T02:18:03.314Z
---
# 设计记录（Design Record）— 2026-10-08-backend-node22-for-sillyspec332

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

backend 镜像 node-tools stage 用 `node:${NODE_VERSION}-slim`，原 NODE_VERSION=20；sillyspec 3.32.0（engines 要求 Node >=22.13.0）用 `node:sqlite` 内置模块存进度库，Node 20 下容器内任何 sillyspec 命令直接 `ERR_UNKNOWN_BUILTIN_MODULE` 崩溃——平台技能包已刷到 3.32.0（含 flow 协议），容器 CLI 必须同版才能配套。

方案：`backend/Dockerfile` 一行 `ARG NODE_VERSION=20 → 22`（node:22-slim LTS，当前 22.x ≥ 22.13 满足 engines），附注释说明依赖缘由。node-tools stage 换 base 全量重建（npm 装 claude-code+sillyspec）；runtime stage 本变更不动任何 ARG 值（SILLYSPEC_VERSION 已在 deploy/.env pin 3.32.0），apt 层缓存命中不重跑。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无 Python/TS 代码接口变化。可见变化仅容器运行时：`node --version` 20→22（npm/claude/sillyspec 二进制同批换新），容器内 `sillyspec` 命令从「启动即崩」变为可用（3.32.0，含 flow 子命令）。apt 包集合、venv、daemon 分发物、skills COPY 语义零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立——镜像构建是确定性单线程产物，Node 22 对既有 node 代码向后兼容（claude-code 2.1.158 engines >=18；daemon bundle 纯 JS 无 native 依赖）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   构建期无共享写面；runtime 期容器单实例。变更时 `git status` 已知外来 menu-permissions 脏文件，提交用显式 pathspec（backend/Dockerfile）隔离。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   容器重建时在途会话由平台自身生命周期管理（与历次 backend 重建一致）；sillyspec 进度库在 worktree/宿主侧不在容器内，重建无状态损失。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   只影响本仓 backend 镜像；宿主 daemon 与远程部署是独立 CLI 安装面，不受容器内 Node 版本影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：node:22-slim 与既有层交互（如 npm 路径结构变化致 ln -sf 失效）——node 官方镜像 npm-cli.js 路径多年稳定，构建本身即验证（失败即暴露，本次实跑通过）。放弃方案：①回退 SILLYSPEC_VERSION pin 到 3.29.x（Node 20 可跑）——放弃理由：技能包已 3.32.0，CLI 落后会再次制造本次要修的「指引与技能不配套」，且 node:sqlite 是 DB 引擎长期依赖，绕不过；②容器内热修 npm install（不进镜像）——放弃理由：容器重建即丢，违反镜像即真相。
