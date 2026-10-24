---
author: flow-machine-draft
created_at: 2026-10-24T04:19:36.124Z
---
# 设计记录（Design Record）— 2026-10-24-backend-mem-limit-raise

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

单值改动 + 注释重写：deploy/docker-compose.yml backend 服务 `mem_limit: 1100m → 2500m`，并把过时的「服务器 1.6G」账面注释替换为「宿主实测 7.5G + 25 次 cgroup OOM 证据（2026-10-16~10-23，被杀模型 worker rss 稳定 ~1.05GB）+ 新账面」。选提额而非其它方案的理由：宿主实测 7.5G / available 5.9G 余量充足，问题纯属 cgroup 人为上限（1100m）装不下「主进程 ~460MB + 任一模型 worker 峰值 ~1.05GB」；提额改动面最小（一行 + 注释）、不动部署管线与代码；2500m 同时兜住双 worker 并存（嵌入 fastembed + 翻译 ct2）与批量推理峰值。

依据：服务器 dmesg 25 条 `Memory cgroup out of memory` 记录（10-16 三次 → 10-23 九次，随 10-15 嵌入、10-19/10-22 翻译 worker 上线而密集化）、docker stats 实测主进程 460MiB、宿主 free -h 7.5Gi total / 5.9Gi available。上游因果（OOM → 前端读请求 30s 超时连续 5 次 → 熔断横幅）已在会话排查确认，本变更治根。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无代码接口/端点/函数变化。部署契约变化一处：backend 容器 cgroup memory limit 由 1100m 提至 2500m（宿主侧 backend 可占内存上限 +1.4G）。前端、daemon、API 行为零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   不适用：纯静态配置值变更，无事件流。recreate 部署窗口（migration + uvicorn 启动，数十秒）期间请求短暂中断属预期，前端熔断横幅按既有机制自愈（ql-20260917-011 正是为该窗口设计）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   compose 文件本会话单点编辑；部署窗口内服务器侧若有并行部署会话会产生 compose 版本竞争——本次部署紧跟同步执行 `up -d`，窗口极短；git 侧按规则用显式 pathspec 提交，不夹带并行会话暂存面。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   recreate backend = 容器重启（重启策略 unless-stopped 兜底；command 内 alembic migration 幂等）。数据卷（pgdata/redis/minio/worktree）不受影响；进行中的 agent 会话由 daemon 侧持有，backend 重启后 patrol 恢复。内存策略（oom_score_adj -500 主进程保护 / worker 自重置 0）不变，仅水位上移。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   仅生产服务器（124.222.127.242）backend 容器；deploy/docker-compose.dev.yml 无 mem_limit（已核实），本地开发不受影响；单机单实例无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：若后续再引入第三类常驻模型 worker 或批量推理峰值再涨，2500m 仍可能触顶——但 cgroup OOM 兜底行为不变（杀 worker 保主进程），且宿主 7.5G 对 2500m 上限仍有 3G+ 安全边际，风险可控。放弃的方案：①worker 拆独立 sidecar 容器（治本但改部署管线与进程拓扑，改动面大，超出本次决策范围）；②调小嵌入/翻译批上限（治标：压峰不治底，主进程+单 worker 稳态仍贴 1100m 顶，且推理延迟恶化）；③不设 mem_limit（失去 OOM 隔离，宿主与其它容器暴露在被挤爆风险下）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| M | deploy/docker-compose.yml | backend mem_limit 1100m→2500m；注释替换为 7.5G 实测 + OOM 证据账面 |
