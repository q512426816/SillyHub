# 部署期裁决补记（2026-10-15 阿里云生产部署）

> 性质：本文档晚于 verify-result.md，记录 verify 通过后、生产部署实施期暴露的问题裁决与修复。
> 证据与提交均已落地（提交链 + 发布记录 #003），归档时随变更留档。

## 背景

verify 7/7 通过后按用户指令「提交推送代码，重新部署阿里云服务器」执行生产部署
（backend + frontend + pgvector/pgvector:pg16 三镜像，postgres 换镜像保留数据卷）。
部署实施期暴露 5 项设计未覆盖问题，均以实证驱动裁决修复。

## 部署期裁决 D-014 ~ D-018

- **D-014 建库嵌入写入改「分批 + Core 批量 INSERT」，mem_limit 800m→1100m**
  证据：容器 800m 限额下整批嵌入 6586 chunks 峰值 689MB+ 被 cgroup OOM kill（服务器总内存 1.6G）；
  修后逐条 ORM INSERT 实测 2.2s/条（需 2h+）再改 Core executemany 多值 VALUES 单往返。
  提交：b375f8dd3（分批 _EMBED_BATCH=32）→ fde592951（flush+expunge 释放 identity map）→
  09bc9e15d（Core 批量 INSERT）→ bde3f1025（compose mem_limit 1100m）。
- **D-015 移除 uq(workspace_id, spec_path, anchor, title) 约束；差量/去重键改行号坐标 (spec_path, start_line)**
  证据：真实语料跨变更重号 + 模板同标题（多个「## D-001@v1 风险与死路（design 槽4 收割）」）
  首建库 INSERT 即 UniqueViolationError。新迁移 20261016010000 drop 约束；
  重号共存测试替换原 uq 拒绝测试；迁移钉子 head 前移。
  提交：be4f1ab13。
- **D-016 PG 向量路改原生 SQL（`embedding <=> CAST(:qv AS vector)`）+ _HitRow 双方言统一候选视图**
  证据：`with_variant` 基类型（JSON）InstrumentedAttribute 取不到 `cosine_distance`
  （AttributeError——.embedding 属性在 ORM 层是 JSON 类型）。提交：3fd1a5d2b。
- **D-017 模型缓存挂载 `./models/fastembed_cache:/tmp/fastembed_cache`**
  证据：服务器无外网，fastembed 首用下载 HuggingFace 模型不可达（加载静默卡死）；
  本机 scp bge-small-zh-v1.5 缓存（~91MB）预置，容器内目录须 uid 可写。提交：bde3f1025。
- **D-018 建库执行位置改「本机（20 核）+ SSH 隧道直写生产库」**
  证据：服务器 1.6G 内存跑全量嵌入不可行（D-014 同源）；`ssh -L 15432:<PG容器IP>:5432`
  隧道 + 本机嵌入，228.7s 完成 6712 chunks 全量建库（一次性）。生产容器只跑查询。

## 生产实测（验收数字）

- 建库：本机 20 核嵌入 228.7s → 生产库 6712 chunks，vector 扩展 0.8.7，alembic
  head = 20261016010000。
- 查询：**首查 3.3s**（零重建直查；改造前同场景 304s 冷构建）→ 二次 0.72s；
  语义命中 5 条（0.42~0.44 分，如「预会话态」→ knowledge/fr/lib-daemon.md）。
- 5 容器 healthy（backend commit_sha=3fd1a5d2b 部署时点）。

## 发布记录

- docs/releases/2026-10-16-003-09bc9e15d.md（发布记录 #003，含建库三修链与实测数字，
  后续补记见 #003 增补提交 c34878970）。
