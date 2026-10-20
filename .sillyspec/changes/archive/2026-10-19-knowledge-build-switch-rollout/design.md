---
author: flow-machine-draft
created_at: 2026-10-19T06:59:20.582Z
---
# 设计记录（Design Record）— 2026-10-19-knowledge-build-switch-rollout

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）？

纯部署落地变更，零代码改动：① `deploy/.env`（gitignore）追加 `KNOWLEDGE_SEARCH_SERVER_BUILD=0`；② 顺带修复 postgres 镜像漂移——运行实例仍是 `postgres:16-alpine` 而 compose 早已声明 `pgvector/pgvector:pg16`，若不先切换，新 backend 启动时 pgvector 迁移会 fail-closed（CREATE EXTENSION vector 不可用）crash-loop——先拉镜像 recreate postgres（pgdata 卷沿用），再 `up --build --force-recreate -d backend`（Windows 注意项：不传 COMMIT_SHA 避免 apt 层重跑）；③ 端到端实测两未建索引工作区首搜；④ 发布记录 + `.env.example` 文档化 + known-issues 状态更新。选此方案的原因：开关代码已在前变更交付并有单测；部署面按 deploy skill 既有 routine 执行，沿用其验证/记录规范。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 无代码接口变化。配置面：目标部署新增 env `KNOWLEDGE_SEARCH_SERVER_BUILD=0`（行为上唯一可见变化=容器内建库开关关闭）；postgres 运行镜像从 postgres:16-alpine 换成 pgvector/pgvector:pg16（数据卷/连接参数不变）。
- 文件面：新增 `docs/releases/2026-10-19-013-d789317d.md`（平台 deploy-records 数据源，frontmatter 契约）；`deploy/.env.example` 追加开关文档化注释（默认注释态，不改变新环境默认行为）；`known-issues.md` 地雷条目状态行更新。`deploy/.env` 本体 gitignore，不入库。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：不适用——部署是单次有序操作序列（env→postgres→backend）；唯一时序约束=postgres 必须先于 backend 完成切换（已按序执行并验证）。

2. 并发写：部署窗口内后端短暂不可用；postgres recreate 为数据服务重启（卷沿用、无数据迁移）。并行会话此刻在跑自己的变更与平台同步——本部署对平台同步的影响=窗口内请求可能失败重试（spec-sync 自带重试/后台化）；无数据竞争（DB 卷单写者）。

3. 切换/生命周期：backend 容器替换中断时旧容器可回滚（镜像 tag 不变，重建前镜像层仍可回退）；postgres 镜像切换失败时 pgdata 未动、可回退旧镜像启动。开关翻转（env 变化）只需 recreate backend，无持久状态迁移。

4. 作用域：仅本地 docker 平台（127.0.0.1）；生产服务器未动（其 env 与容器独立，剩余动作已登记 known-issues）。发布记录 commit_from/commit_to 锚定本仓提交面，跨仓无对象。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险①：镜像重建卷入并行会话的在途提交（构建用工作树快照，非 HEAD）——已核：构建起始 ≈7e9c795ef，其后提交均为前端/测试/文档/存档面（发布记录显式注记）。对策：构建前确认工作树解并记录快照锚。
- 风险②：后端新镜像携带未在生产验证过的 pgvector 迁移 + translate 新功能——本地平台本就是验证环境（数据可清空口径），迁移 fail-closed 设计自带护栏；translate 有 37 测试 + 评审。接受。
- 风险③：部署记录 seq 与并行会话的记录取号竞争（同用 next-release-seq.sh）——取号 22 立即落盘；若并发同号，后写者可据文件核对修正（留待观察）。
- 风险④：未建索引词面降级每次搜索全语料扫描（热查 2.9-15.1s 抖动）——设计期已裁决可接受（运维例外态）；本次实测数据佐证并如实记录，未触发超时螺旋即满足底线。
- 放弃方案A：仅 restart backend 不重建镜像——新镜像才是开关生效前提（代码在镜像内），否决。
- 放弃方案B：同时重建 frontend——本次范围仅后端开关落地；前端翻译 UI 部署归后续前端部署，避免扩大爆炸半径。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | deploy/.env.example | 文档化 KNOWLEDGE_SEARCH_SERVER_BUILD（注释态） |
| 新增 | docs/releases/2026-10-19-013-d789317d.md | 发布记录（seq 22，commit 0a0e9c76→d789317d） |
| 修改 | .sillyspec/knowledge/known-issues.md | 地雷条目状态更新（本地已配实证） |
| 修改 | deploy/.env | 追加 KNOWLEDGE_SEARCH_SERVER_BUILD=0（gitignore，不入冻结面——已本机生效并经容器内 settings 实测，审计缺口=该文件本就不入库，非遗漏） |
