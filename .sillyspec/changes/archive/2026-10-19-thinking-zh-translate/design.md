---
author: flow-machine-draft
created_at: 2026-10-19T05:30:09.503Z
---
# 设计记录（Design Record）— 2026-10-19-thinking-zh-translate

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：agent 思考内容（`[THINKING]` stdout 流 → 前端 `kind:"thinking"` 段）常为英文，用户看不懂；要求离线（不调云翻译 API）、默认中文、性能可控。

方案：**后端本地翻译服务 + 前端按需渲染**。后端新建 `app/modules/translate/` 模块，用 CTranslate2 加载 opus-mt-en-zh int8 量化模型做 en→zh 离线推理——完全复刻既有 fastembed embedding worker 的成熟模式（knowledge/vector_search.py + embedding_worker.py）：模型在独立子进程（行协议 stdin/stdout），三闸自灭（闲置/父亡/寿命帽）+ 崩溃退避 + fail-soft（模型缺席/加载失败 → 端点返回 engine_ready=false，应用启动零阻塞）。前端新建 `lib/thinking-translate.ts`（合批 client + 启发式跳过 + 内存缓存）与共享组件 `TranslatedThinkingBody`，在三条思考渲染路径（ThinkingRowView / TurnDetailsList / AgentLogViewer / 回放卡）统一接入。

性能设计核心是**把翻译负载压到「用户真的在看」的时机**：折叠摘要只在流结束/静态挂载后翻译前 500 字符（头部稳定，一次请求终身缓存命中）；展开正文只在展开时翻译且流式中先显示原文；同屏多块 250ms 窗口合批单请求；译文后端 LRU + Redis 双层缓存零重复推理。

选型依据：浏览器端 transformers.js 方案（~80MB 模型 + WASM 推理 + 每用户各自下载）直接违背「考虑性能」，放弃；词典式翻译（translate.js 类）对复杂英文句子质量不可读，放弃；服务端 CTranslate2 int8（模型 ~100-150MB 一次下载全体共享、CPU 批推理常见几百字符思考秒级返回）是质量/体积/性能的平衡点，且与平台既有「本地小模型 + fail-soft」基建哲学同构（bge-small-zh 先例）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

新增（既有接口零改动）：

- `POST /api/translate/thinking`（main.py 挂载，鉴权 `require_permission_any(Permission.TASK_RUN_AGENT)`，与 daemon 会话 logs 读权限同款——思考内容可见面与该权限一致）
  - 请求：`{"items": [{"id": "<客户端生成 stable id>", "text": "<≤20000 字符>"}], "target": "zh"}`（items ≤16 条/请求，总字符 ≤80000，超限 422）
  - 响应：`{"ok": true, "engine_ready": bool, "reason": str | null, "items": [{"id", "text", "translated": bool}]}`——`translated=false` 表示原文透传（不值得翻/引擎不可用）；`engine_ready=false` 是 200 不是 5xx（fail-soft 契约对齐 vector-search 的 model_ready）
- 子进程行协议（内部）：`{"id": int, "op": "translate", "texts": [str]}` → `{"id": int, "ok": true, "translations": [str]}` / `{"ok": false, "error": str}`（embedding_worker 同款）
- 配置（app/core/config.py + env）：`translate_thinking_enabled`（默认 true，总闸）、`translate_model_repo`（默认 HF ct2 格式 opus-mt-en-zh int8 repo）、`translate_model_dir`（默认空=自动下载；离线部署指向本地目录）、`translate_worker_idle_exit_sec`（默认 600）、`translate_cache_max_entries`（默认 2048）
- 前端新增模块（不进 api-types.ts 自动生成面，本地手写类型——daemon/sessions.ts 先例）：`lib/thinking-translate.ts` 导出 `translateTexts()` / `needsTranslation()` / `splitIntoChunks()`；`stores/thinking-translate.ts` zustand persist（localStorage key `sillyhub-thinking-translate`，默认 on）

无外部行为变化的既有面：SSE 流通道（session-stream/session-sse/session_insights.py）零改动；`[THINKING]` 落库格式零改动（翻译是展示层语义，译文不落库——原文是审计真相源）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. **乱序/迟到到达**：流式思考 partial 乱序/迟到由既有 assembler 处理，本设计不碰流通道。摘要翻译锚定「文本头部前 500 字符」——头部在流式早期即稳定，后续增量不改变已翻译前缀（缓存 key=精确文本，命中即免重翻）；分块翻译按序号拼接，块间乱序返回由前端按请求内索引重组（单请求内后端保序返回，跨请求按请求 Promise.all 顺序组装）。展开正文的翻译在流结束（streaming=false）后才触发，不存在与增量文本的竞态。

2. **并发写**：后端 LRU/Redis 只写「文本 hash → 译文」纯函数结果，幂等，多请求并发写同 key 值相同无损；翻译子进程经单把锁串行化请求（embedding proxy 同款 `_lock`），多 worker 副本各自进程独立缓存，最终一致。前端模块级缓存/pending map 在单页面 JS 线程内无并发写问题；多浏览器标签各自持缓存，只可能重复请求不冲突。

3. **切换/生命周期**：翻译子进程三闸自灭（闲置 600s/父亡 EOF/寿命帽）内存确定性归还；自灭后下次请求单次透明重启重试（embedding proxy 同款语义）；用户中途关闭页面 → fetch abort，后端请求已完成与否无副作用（纯读 + 幂等缓存写）；「译文/原文」切换是组件本地 state，重挂载回默认译文（全局偏好仍是 on）。崩溃退避期（连续 3 次）内请求立即 fail-soft 返回原文，退避满自动恢复。

4. **作用域**：缓存 key 含目标语言命名空间（`translate:v1:zh:{sha1}`）不与其它 Redis 键串台；译文缓存不分用户（翻译是文本纯函数，无用户隔离语义——同文本同译文，泄漏面为零：不含任何用户/会话元数据）；多实例部署时 HF 下载目录按主机本地（TRANSLATE_MODEL_DIR 显式配置时由部署方保证共享或各自持有）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：**opus-mt en→zh 对技术思考文本的翻译质量一般**（2020 年代模型，专有名词/代码混杂句式偶有生硬）——预期是「能看懂大意」而非信达雅；缓解：代码块/URL/行内代码保护不送翻（减少破坏面），「显示原文」一键可退。若后续要更好质量，模型 repo 是配置项可换（如更大 ct2 模型），接口契约不变。

次要风险：①模型首用下载 ~100-150MB，离线/弱网环境不可达——TRANSLATE_MODEL_DIR 预置 + fail-soft 已覆盖，Docker 预烤文档化；②ctranslate2 依赖体积（wheel 数十 MB）——后端镜像可接受，Dockerfile 是 lock-less 安装直接生效；③摘要翻译对「前 500 字符截断处恰在句中」的边界——截断到最近句界再送翻，避免半句译文。

试过放弃的方案：浏览器端 transformers.js（性能不可接受，见做法概述）；argos-translate（Python 包管理器下载源不可配镜像、版本锁死，不如直接 ct2）；译文落库（违反「原文是审计真相源」原则且膨胀存储，缓存层已足够）；SSE 流式逐 delta 翻译（80 字符/120ms 的增量粒度翻译必产生请求风暴与重复推理，折叠默认态根本不需要实时译文——按需模式把负载降 2-3 个数量级）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/translate/__init__.py | 模块包 |
| 新增 | backend/app/modules/translate/schema.py | 请求/响应 DTO 与限额常量 |
| 新增 | backend/app/modules/translate/chunking.py | 纯函数：代码保护切分/值得翻判定/分块 |
| 新增 | backend/app/modules/translate/engine.py | CTranslate2 子进程代理（embedding proxy 同款模式） |
| 新增 | backend/app/modules/translate/translate_worker.py | 翻译子进程（行协议 + 三闸自灭 + 模型解析/下载） |
| 新增 | backend/app/modules/translate/service.py | 缓存（LRU + Redis best-effort）+ 编排 |
| 新增 | backend/app/modules/translate/router.py | POST /api/translate/thinking 端点 |
| 新增 | backend/app/modules/translate/tests/__init__.py | 测试包 |
| 新增 | backend/app/modules/translate/tests/test_chunking.py | 分块/保护/启发式纯函数测试 |
| 新增 | backend/app/modules/translate/tests/test_engine.py | fake worker 注入的代理协议/退避测试 |
| 新增 | backend/app/modules/translate/tests/test_service.py | LRU/Redis fail-soft/编排测试 |
| 新增 | backend/app/modules/translate/tests/test_router.py | 鉴权/限额/fail-soft 端点测试 |
| 修改 | backend/app/core/config.py | translate_* 配置组 |
| 修改 | backend/app/main.py | 挂载 translate router（/api 前缀） |
| 修改 | backend/pyproject.toml | +ctranslate2>=4.5 |
| 新增 | frontend/src/lib/thinking-translate.ts | 合批 client + 启发式 + 分块 + 缓存 |
| 新增 | frontend/src/lib/__tests__/thinking-translate.test.ts | client 单测 |
| 新增 | frontend/src/components/thinking-translate/index.tsx | TranslatedThinkingBody 共享组件 + useTranslatedText hook |
| 新增 | frontend/src/components/thinking-translate/__tests__/translated-thinking.test.tsx | 组件/hook 测试 |
| 新增 | frontend/src/stores/thinking-translate.ts | zustand persist 偏好（默认开） |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | ThinkingRowView 接入（摘要+正文） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | TurnDetailsList 思考组接入 |
| 修改 | frontend/src/components/agent-log-viewer.tsx | 思考折叠块接入 |
| 修改 | frontend/src/components/daemon/agent-log-card.tsx | 回放卡思考段接入 |
| 新增 | frontend/src/components/daemon/__tests__/turn-segment-views-thinking-translate.test.tsx | 接入测试 |
| 新增 | backend/app/modules/translate/README.md | 部署文档：模型预烤/TRANSLATE_MODEL_DIR 离线配置/HF_ENDPOINT 镜像/fail-soft 语义 |
