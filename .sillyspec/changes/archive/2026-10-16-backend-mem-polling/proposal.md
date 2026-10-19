---
author: qinyi
created_at: 2026-10-16 09:52:00
---
# 提案书（Proposal）

## 动机

生产服务器（阿里云 2 核 / 1.6G 内存）反复整机卡顿，2026-10-15 夜间 backend 容器被内核 OOM 强杀 7 次（23:14~01:32）。诊断确认三层问题叠加：昨日部署的知识搜索变更把 fastembed 嵌入模型常驻 backend 进程（急性回归主因）；两处无界缓存与权限定时器 session 泄漏（慢性缺陷）；change-write 30s 硬轮询与会话列表窗口查询（慢性负载）。用户裁决走代码侧全面根治（方案 A，决策 D-001@v1）。

## 关键问题

1. 嵌入模型进程内单例永不释放（ONNX arena 棘轮）+ `_indexes` 向量索引跨工作区无上限（每 ws 11~40MB 永驻）——backend RSS 数小时内 324MB→750MB 直到撑爆 1.1G cgroup 被 OOM 强杀，重启后重连风暴 7 分钟又冲到 494MB。
2. 权限 5 分钟超时定时器 pin 已关闭的 AsyncSession 且部分路径不提交——生产 postgres 频发 idle-in-transaction FATAL；ws_hub `_pending_rpcs` 泄漏与 disconnect 无身份校验在重连风暴中自我放大。
3. change-write 走 30s 硬轮询（唯一分发通道）；`GET /api/daemon/sessions?limit=500` 每次对 agent_run_logs 做窗口函数派生标题，实测 1.4s 且随日志量线性。

## 变更范围

四 Phase：①内存治理（嵌入子进程封装三闸自灭 + 索引缓存 LRU + gzip 缓存全局帽 + 权限 session 治理 + ws_hub 修复 + 杂项）；②change-writes 改 WS 事件推送、轮询降 120s 兜底；③agent_sessions 加 title_fallback 列 + 回填迁移 + 列表读列自愈；④compose 配额重分配 2.14G→1.85G + oom_score_adj 保护。

## 不在范围内（显式清单）

- 不升配硬件、不改 Docker 拓扑（不加 sidecar）、不改 nginx
- 不动前端代码与会话列表交互
- 不动知识搜索 pgvector 表结构与检索语义
- 不改 lease/controls 既有分发机制
- 不清理 agent_run_logs 历史数据

## 成功标准（可验证）

- 嵌入查询后闲置 15 分钟，backend 主进程 RSS 回落（子进程退出，内存归还 OS）；万不得已 OOM 时被杀的是嵌入子进程而非主进程
- 两处缓存（向量索引 / gzip 包）到达上限后按 LRU 淘汰，不再无界增长；postgres 不再出现 idle-in-transaction FATAL
- change-write 稳态轮询请求从每 runtime 每 30s 一次降为 120s 兜底（事件驱动分发），稳态请求率降 ~75%
- `GET /api/daemon/sessions?limit=500` 无窗口函数扫描，查询毫秒级
- 旧 daemon 对新 backend 完全兼容（未知消息 warn 丢弃，兜底轮询仍在）；容器配额总和 1.85G
- 服务器部署实测：backend 稳态内存不单调爬升至 OOM，整机不再 swap 抖动卡顿
