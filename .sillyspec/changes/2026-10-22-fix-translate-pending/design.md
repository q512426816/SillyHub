---
author: flow-machine-draft
created_at: 2026-10-22T01:21:32.514Z
---
# 设计记录（Design Record）— 2026-10-22-fix-translate-pending

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题根因：生产容器未配置 `TRANSLATE_MODEL_DIR`，worker 子进程走 HuggingFace 下载且该域名在服务器不可达（`huggingface.co` 解析到被污染地址、TCP 不可达；实测 `hf-mirror.com:443` 可达），主进程 `REQUEST_TIMEOUT_SEC=300` 于是长时间阻塞；前端 POST 无超时，界面表现为永久「翻译中」。修复分三层：① 前端给该请求传 20 秒超时，超时走既有的「引擎不可用」降级与 60 秒退避链（复用现有 catch 分支，不改状态机）；② 后端把请求超时改为配置项并默认 20 秒，让任何异常慢路径快速 fail-soft；③ 子进程 stderr 由后台线程转入主进程日志，失败可查。部署侧用 `hf-mirror.com` 在服务器一次性下载 ct2 模型到宿主机 `deploy/models/opus-mt-en-zh`，compose 挂载并透传 `TRANSLATE_MODEL_DIR`，实现零下载加载。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `frontend/src/lib/thinking-translate.ts`：`requestBatch` 的 `apiFetch` 调用新增 `timeoutMs: 20_000`（`apiFetch` 既有选项，无签名变化）。
- `TranslateSubprocessProxy.__init__` 新增关键字参数 `request_timeout_sec: float | None = None`；`None` 时从 `get_settings().translate_request_timeout_sec` 读取。`REQUEST_TIMEOUT_SEC` 类常量移除，测试改为构造参数注入。
- `app.core.config.Settings` 新增 `translate_request_timeout_sec: float = 20.0`（env `TRANSLATE_REQUEST_TIMEOUT_SEC`）。
- `deploy/docker-compose.yml` backend 段新增挂载 `./models/opus-mt-en-zh:/opt/models/opus-mt-en-zh` 与环境变量 `TRANSLATE_MODEL_DIR: ${TRANSLATE_MODEL_DIR:-}`。
- HTTP 端点与响应结构不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立：超时 kill 子进程后，旧读线程可能把迟到的响应行写入重启后的新队列；`translate()` 用请求 id 严格校验，不匹配即按崩溃处理并单次重启重试，不会把旧响应错配给新请求。该风险为既有行为，本变更不扩大。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

`translate()` 全程持 `self._lock`，多个 HTTP 翻译请求串行；deadline 在取锁前计算，排队时间计入等待预算——排队久于 20 秒的请求会快速 fail-soft 而不是无限排队，符合降级目标。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：超时按崩溃计数，连续 3 次进入 600 秒退避；退避到点后 `available` 自然翻回 true 并懒重启。模型目录预置在宿主机挂载，容器重建不影响。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：翻译器是进程级单例，每个 backend 进程独立；缓存键含目标语言与文本哈希，无跨工作区数据。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：20 秒对超大模型冷加载偏紧——opus-mt int8 实测加载 1~3 秒，余量充足；未来换更大模型时上调 `TRANSLATE_REQUEST_TIMEOUT_SEC`（已配置化）。
- 评审 P2 修复：20s 是整批预算，而 16×1000 字符满批在 2 核生产机实测 21.5s——单一 20s 会误杀正常推理并累计崩溃计数（3 次即 600s 退避，翻译永久不可用）。改为按批线性放宽（每条 +2.5s，满批约 57.5s），基准值 20s 不变。
- 风险：若生产 `.env` 漏设 `TRANSLATE_MODEL_DIR`，会回退 HF 下载路径并在 20 秒内 fail-soft（界面可接受，但功能不可用）——部署验证必须显式核对该变量。
- 放弃方案：仅配置 `HF_ENDPOINT=https://hf-mirror.com` 靠首次请求在线下载。放弃理由：首次请求仍要等 100~150MB 下载（远超 20 秒超时窗），且容器重建后缓存丢失，问题会反复出现。
- 放弃方案：沿用 300 秒超时只在生产预置模型。放弃理由：任何慢路径（网络抖动/模型损坏）都会再次让界面挂 5 分钟，缺少兜底。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/lib/thinking-translate.ts | 翻译请求传 20s 超时 |
| 修改 | frontend/src/lib/__tests__/thinking-translate.test.ts | 新增超时参数与降级用例 |
| 修改 | backend/app/modules/translate/engine.py | 超时可配置、stderr 转日志 |
| 修改 | backend/app/core/config.py | 新增 translate_request_timeout_sec |
| 修改 | backend/app/modules/translate/tests/test_engine.py | 新增超时与日志用例 |
| 修改 | deploy/docker-compose.yml | 模型挂载 + TRANSLATE_MODEL_DIR 透传 |
| 修改 | backend/app/modules/translate/README.md | 补超时/日志/预置部署说明 |
