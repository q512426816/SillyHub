---
author: flow-machine-draft
created_at: 2026-10-24T04:19:36.123Z
---
# 提案书（Proposal）— 2026-10-24-backend-mem-limit-raise

## 动机

任务原话转写：提升 backend 容器内存限额防 OOM

动机与背景：
服务器实测宿主内存 7.5G（compose 旧注释「服务器 1.6G」认知过时，available 常年 5.9G），而 backend 容器 mem_limit 1100m 装不下 uvicorn 主进程（~460MB）+ 模型 worker 子进程（嵌入 fastembed / 翻译 ct2，峰值 rss ~1.05GB）。2026-10-16 以来内核日志 25 次 cgroup OOM（10-23 一天 9 次，全部杀 oom_score_adj=0 的 worker），OOM 窗口容器卡顿导致前端读请求 30s 超时连续 5 次，反复触发全局熔断横幅「与服务器的连接暂时中断」。宿主余量充足，提额是治本项。

成功标准：
- deploy/docker-compose.yml backend mem_limit 从 1100m 提到 2500m，注释修正「服务器 1.6G」过时认知并记入实测 7.5G 与 OOM 证据
- 服务器同步新 compose 并 recreate backend 后 docker stats 显示 limit 约 2.44GiB，容器 healthy

## 变更范围

按成功标准机械推导，共 2 条验收面：
1. deploy/docker-compose.yml backend mem_limit 从 1100m 提到 2500m，注释修正「服务器 1.6G」过时认知并记入实测 7.5G 与 OOM 证据
2. 服务器同步新 compose 并 recreate backend 后 docker stats 显示 limit 约 2.44GiB，容器 healthy

## 成功标准（可验证）

1. deploy/docker-compose.yml backend mem_limit 从 1100m 提到 2500m，注释修正「服务器 1.6G」过时认知并记入实测 7.5G 与 OOM 证据
2. 服务器同步新 compose 并 recreate backend 后 docker stats 显示 limit 约 2.44GiB，容器 healthy
