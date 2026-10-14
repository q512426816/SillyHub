---
author: flow-machine-draft
created_at: 2026-10-14T04:08:12.184Z
---
# 设计记录（Design Record）— 2026-10-14-litellm-retire

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

按用户 2026-10-14「彻底退役」拍板，从两个 compose 中整体删除 litellm 技术栈（`litellm` / `litellm-db` 服务块、`litellm-db-data` 卷、dev 侧网络附接注释）与唯一专属配置文件 `deploy/litellm-config.yaml`；本机四容器 stop+rm（命名卷数据保留可回滚）；坑记录移 finished/ 闭坑（服务器侧清理并入下次部署窗口，load-and-up.sh 已有 `config --services` 启动集打印，多出/缺少服务立见）。backend 代码面（admin API 注册、provider_config 的 litellm_model_name/litellm_base_url 语义）不动——平台对 openai_like 供应商的转换能力是运行时路径，退役的是基础设施供给，未来若重引转换网关再立新变更。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `deploy/docker-compose.yml` / `deploy/docker-compose.dev.yml`：服务清单少 litellm 系（prod 核心 5 服务不变、dev 2 服务不变）；`LITELLM_DB_PASSWORD` env 要求随之消失（.env 残留该键无害）。
- 删除文件：`deploy/litellm-config.yaml`（全仓唯一活引用是 litellm 服务 bind mount）。
- 运行态：本机 4 容器移除；命名卷 `multi-agent-platform_litellm-db-data` / dev 同名卷保留。
- 无 REST/schema/前端类型面变化；`docs/sillyspec/` 坑记录迁移（active → finished）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：服务器与本机状态解耦——服务器 compose 仍是旧版（含 litellm 定义但 stop），下次部署窗口用 deploy-to-server 的 scp compose 同步 + `config --services` 打印自然收敛；窗口前若有人手动 `--profile litellm` 拉起属显式动作，不影响本变更。
2. 并发写：本机容器操作针对固定四容器名，与并行会话无交集（backend/redis/postgres/frontend 容器不碰）；compose 文件编辑为纯删除块，无共享行。
3. 切换/生命周期：卷数据保留——若未来重引 litellm，`docker volume` 数据与 .env 的 LITELLM_DB_PASSWORD 均在，回滚成本低（revert 提交 + up 显式点名即可）。
4. 作用域：prod 与 dev 两个 compose 各自独立删块；服务器（阿里云）不在本变更运行态操作面内（留部署窗口），其旧 compose 与本仓的差异由既有「镜像同步 ≠ 配置同步」教训清单覆盖。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：未来新增 openai_like 供应商（无原生 anthropic 端点的上游）时转换链路缺失——当前零供应商依赖 litellm，且重引路径已文档化（本坑记录 + spike-litellm-routing 历史可考古）；接受。次风险：本机 plain v1.95.0 healthy 3 天提示上游构建可能已修复，退役放弃了「零成本复测复活」机会——拍板时已向用户披露并选择退役（不再等上游）。死路：尝试「只删 prod 留 dev」——两处定义漂移正是 10-06 compose 同步教训的反面，不留双态。
