# 决策知识 — build

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-build-001@v1 2026-10-05-litellm-crashloop-quarantine——给 `litellm` 与 `litellm-db` 两服务各加一行 `profiles: ["litellm"]`：v1.95.x 两个镜像变体 均为 ghc
状态：implemented
变更：2026-10-05-litellm-crashloop-quarantine
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-05-litellm-crashloop-quarantine/design.md
文件：deploy/docker-compose.yml, docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md
最近确认：未记录
理由：给 `litellm` 与 `litellm-db` 两服务各加一行 `profiles: ["litellm"]`：v1.95.x 两个镜像变体 均为 ghcr 坏构建、且 2026-10-05 本地矩阵证实无可 pin 的健康 tag（坑文档在案），而 `restart: always` + 部署 skill 标准收尾 `up -d` 的组合会让坏镜像在下次常规部署必然重新 进入无限重启。profiles 是 Compose 原生的「可选服务」机制，把两服务移出默认启用集合， 同时保留全部配置与卷。 选 profiles 而非其它方案的依据：注释掉整块服务——丢失配置可见性、恢复 diff 大；`restart: no` ——`up -d` 仍会拉起坏镜像跑一次崩溃（且 1.6G 机上白拉 200MB+ 坏镜像层），恢复时还易忘改回 always；纯注释提醒——已被证实无拦截力（本次修复的直接动因）。profiles 兼容坑文档既有恢复 命令 `up -d litellm litellm-db`（Compose 显式点名服务自动激活其 profile，v2 语义），零数据 丢失（卷定义不动，`up`/`stop` 均不回收卷）。

## D-build-002@v1 2026-10-06-litellm-log-rotation——在 deploy/docker-compose.yml 的 litellm 服务块尾（mem_limit 之后）新增 logging 块：`driver: js
状态：implemented
变更：2026-10-06-litellm-log-rotation
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-06-litellm-log-rotation/design.md
文件：deploy/docker-compose.yml, docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md, frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts, frontend/src/config/llmProviderPresets.ts
最近确认：未记录
理由：在 deploy/docker-compose.yml 的 litellm 服务块尾（mem_limit 之后）新增 logging 块：`driver: json-file` + `max-size: "10m"` + `max-file: "3"`。这是 2026-10-05-litellm-crashloop-quarantine 的结构性加固补全——profiles 门拦住默认 `up -d` 路径，但注释里写明的复验路径（`--profile litellm` 或显式点名拉起）一旦执行，坏构建镜像在 restart:always 下仍会 crash-loop，而整个 deploy/ 无任何日志轮转配置，json-file 默认无上限，低配服务器磁盘会被打满。 选服务级 compose 配置而非其它方案的依据：改宿主 /etc/docker/daemon.json 全局默认——要动服务器系统状态且影响所有容器，超出本仓变更面；给全部服务统一加 logging——核心服务的日志保留策略变化未评估（排障时可能反而需要更长的日志留存），行为面扩大，留待专门变更评估。只给已知会 crash-loop 的 litellm 加有界轮转，变更面最小且与既有隔离门互补。

## D-build-003@v1 2026-10-24-backend-mem-limit-raise——单值改动 + 注释重写：deploy/docker-compose.yml backend 服务 `mem_limit: 1100m → 2500m`，并把过时
状态：implemented
变更：2026-10-24-backend-mem-limit-raise
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-24-backend-mem-limit-raise/design.md
文件：deploy/docker-compose.yml
最近确认：未记录
理由：单值改动 + 注释重写：deploy/docker-compose.yml backend 服务 `mem_limit: 1100m → 2500m`，并把过时的「服务器 1.6G」账面注释替换为「宿主实测 7.5G + 25 次 cgroup OOM 证据（2026-10-16~10-23，被杀模型 worker rss 稳定 ~1.05GB）+ 新账面」。选提额而非其它方案的理由：宿主实测 7.5G / available 5.9G 余量充足，问题纯属 cgroup 人为上限（1100m）装不下「主进程 ~460MB + 任一模型 worker 峰值 ~1.05GB」；提额改动面最小（一行 + 注释）、不动部署管线与代码；2500m 同时兜住双 worker 并存（嵌入 fastembed + 翻译 ct2）与批量推理峰值。 依据：服务器 dmesg 25 条 `Memory cgroup out of memory` 记录（10-16 三次 → 10-23 九次，随 10-15 嵌入、10-19/10-22 翻译 worker 上线而密集化）、docker stats 实测主进程 460MiB、宿主 free -h 7.5Gi total / 5.9Gi available。上游因果（OOM → 前端读请求 30s 超时连续 5 次 → 熔断横幅）已在会话排查确认，本变更治根。
