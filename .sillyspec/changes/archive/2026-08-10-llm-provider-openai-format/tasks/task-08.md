---
id: task-08
title: docker-compose litellm service
title_zh: docker-compose 加 LiteLLM 服务（Wave2 网关部署）
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: [spike-litellm-routing, task-01]
blocks: [task-09]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/deploy/docker-compose.yml
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/deploy/docker-compose.dev.yml
related_tests: []
goal: >
  docker-compose.yml 与 docker-compose.dev.yml 的 services 下新增 litellm 服务（与 backend 同 default 网络，master key 走 .env 不入库不进镜像，healthcheck + restart=always），为 Wave2 Anthropic↔OpenAI 转换网关提供常驻服务（FR-05 / NFR-03 / R-08）。
implementation:
  - services 下加 litellm：image 按 spike-litellm-routing 结论 pin（ghcr.io/berriai/litellm:main-stable 或具体 tag，不浮 latest），与 backend 同 compose default network（不加独立 network，backend 直接 litellm:4000 可达）
  - master key 走环境变量 LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY:?must set}（从 deploy/.env 读，范式对齐现有 SILLYSPEC_MASTER_KEY:?must set），需要时加 LITELLM_SALT_KEY 同样走 env；compose 文件内绝不出现明文 key
  - 挂载 spike 定稿的最小 config（volumes 挂 deploy/litellm-config.yaml 或 config 目录）：model_list 形态由 spike 定（admin API 动态注册则 model_list:[] 起步，config.yaml 静态则预置），store_model_in_db 按 spike 结论开
  - healthcheck：按 spike 确认的端点（/health/liveness 或 /health），test/interval/timeout/retries 风格对齐现有 postgres/redis/minio（interval 5s / timeout 3s / retries 20）
  - restart: always（比现有 unless-stopped 更强；NFR-03/R-08 LiteLLM SPOF 应对，宕自动拉起）
  - 端口不对外暴露（不写 ports，仅同网络可达，R-05 网络隔离；如调试需要，映射到 127.0.0.1 而非 0.0.0.0）
  - backend 服务**不加** depends_on: litellm（anthropic 链路独立，LiteLLM 宕不能拖垮 backend 启动；NFR-03）
  - docker-compose.dev.yml 同步加同一 litellm 服务（dev/prod 一致，C-03 跨平台）
  - deploy/.env.example 加 LITELLM_MASTER_KEY 占位行（注释说明生成方式，不填真值）
acceptance:
  - docker compose -f deploy/docker-compose.yml config 解析无错；dev compose 同样
  - litellm 容器 healthcheck 通过（spike 确认的 health 端点返回 200）
  - backend 容器内可 curl http://litellm:4000/health（同网络可达）
  - compose 文件 grep 不到明文 master key；LITELLM_MASTER_KEY 走 ${...:?must set}
  - litellm 服务 restart: always；无对外的 ports 映射（或仅 127.0.0.1）
  - deploy/.env.example 含 LITELLM_MASTER_KEY 占位
verify:
  - docker compose -f deploy/docker-compose.yml config（解析无错）
  - docker compose -f deploy/docker-compose.yml up -d litellm 后 curl healthcheck 通过（spike 通过后实测）
  - grep -n "LITELLM_MASTER_KEY" deploy/.env.example（占位存在）
  - grep -rn "sk-" deploy/docker-compose*.yml（明文 key 命中 0）
constraints:
  - master key 走 .env 不入库、不进镜像、不进 git（R-05 LiteLLM 新信任边界 + R-08）
  - 必有 healthcheck + restart: always（NFR-03 / R-08 LiteLLM SPOF 应对）
  - litellm 端口不对外暴露（仅 backend 同网络可达，R-05 网络隔离）
  - backend 不加 depends_on litellm（anthropic 链路独立，LiteLLM 宕不影响 anthropic 供应商，NFR-03）
  - 路由机制（admin API 动态注册 vs config.yaml 静态 + /reload）+ 镜像 tag + health 端点 + config 形态一律按 spike-litellm-routing 结论定；spike 未过不做本任务（C-02 前置门）
  - Docker 跨平台一致（C-03，Windows/Linux/macOS）
provides:
  - docker-compose litellm 服务（prod + dev，与 backend 同网络，healthcheck + restart=always）
  - LITELLM_MASTER_KEY 走 .env 通道（不进 git）+ .env.example 占位
  - spike 定稿的最小 litellm config 挂载（供 task-09 admin API 注册/unregister）
expects_from:
  spike-litellm-routing:
    - contract: LiteLLM 路由机制定稿（admin API POST /model/new 动态注册 vs config.yaml + /reload 静态 vs virtual key），含可用的 health 端点、镜像 tag、最小 config.yaml 形态、store_model_in_db 取值
      needs: [路由机制选型, health 端点, 镜像 tag, config.yaml 形态, store_model_in_db 取值]
  task-01:
    - contract: llm_providers 表 api_format 列 + 迁移已落地（Wave1 数据模型基础；本任务不直接读该列，但 openai 供应商可存是 Wave2 端到端前提，按 plan 标 depends_on task-01）
      needs: [api_format 列存在 + 老行 anthropic 回填]
---

# task-08 实现笔记

Wave2 起点（design §5.3 / FR-05 / NFR-03 / R-08）。本任务把 LiteLLM 作为服务器常驻服务部署，平台代码不实现转换（D-012 维持，外包 LiteLLM，design §1/§10/R-07）。

spike-litellm-routing 是 P0 前置门（R-01）：admin API 动态注册能否幂等、Anthropic /v1/messages → OpenAI 流式 + 工具调用转换、角色模型名路由 4 项用例未全过，本任务的 config 形态/镜像 tag/health 端点都不能定稿。spike 失败则 Wave2 推迟或回退备选（virtual key / config 重载），本任务暂停。

不对外暴露端口是安全硬约束：LiteLLM 一旦对公网开放 + master key 泄漏 = 所有 openai 上游 key 暴露（R-05）。仅 backend 同网络可达，master key 走 .env，与现有 SECRET_KEY / SILLYSPEC_MASTER_KEY 同一套凭证管理范式。

backend 不 depends_on litellm：anthropic 供应商链路（今天的主路径）完全不经 LiteLLM，LiteLLM 宕时 anthropic 供应商不受影响（NFR-03 / R-08 应对的核心：隔离故障域）。仅 openai 供应商在 Wave2 合入后依赖 LiteLLM。
