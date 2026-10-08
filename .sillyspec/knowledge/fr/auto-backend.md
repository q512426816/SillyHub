---
author: sillyspec-fr-index
created_at: 2026-10-08T01:35:36.843Z
---

# FR 索引 — auto-backend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-backend-118 sed 换源改为 https://mirror.sjtu.edu.cn（连协议一起换），安装的包集合与语义零变化
变更：2026-10-08-backend-dockerfile-apt-mirror-sjtu
状态：active
摘要：换源不改语义
全文：.sillyspec/changes/archive/2026-10-08-backend-dockerfile-apt-mirror-sjtu/requirements.md#FR-01
最近确认：d304aefe57ac5e79cc74c094f21d1760d3e5ac5f

## FR-auto-backend-119 backend 镜像本地构建通过（apt 层完成即验证），部署链可继续
变更：2026-10-08-backend-dockerfile-apt-mirror-sjtu
状态：active
摘要：构建即验证
全文：.sillyspec/changes/archive/2026-10-08-backend-dockerfile-apt-mirror-sjtu/requirements.md#FR-02
最近确认：d304aefe57ac5e79cc74c094f21d1760d3e5ac5f

## FR-auto-backend-120 Dockerfile 改动以显式 pathspec 提交并在本变更内收口
变更：2026-10-08-backend-dockerfile-apt-mirror-sjtu
状态：active
摘要：收口
全文：.sillyspec/changes/archive/2026-10-08-backend-dockerfile-apt-mirror-sjtu/requirements.md#FR-03
最近确认：d304aefe57ac5e79cc74c094f21d1760d3e5ac5f
