---
author: flow-machine-draft
created_at: 2026-10-22T23:34:31.713Z
---
# 需求规格（Requirements）— 2026-10-23-translate-budget-align

## 功能需求

### FR-01: 前端超时按批大小动态计算（覆盖后端公式并留余量），满批 16 条慢推理不再被前端 abort

- 翻译请求的 HTTP 超时必须按本批内容的最坏后端块数动态计算（镜像后端 `engine._timeout_for` 公式：基准 20s + 每块 2.5s，再外加 5s 余量）；禁止对满批使用固定 20s 定值（e7ce2a101 生产实测 16×1000 满批 21.5s，固定值必误杀并累计崩溃计数）。

#### 场景：主路径

- Given 单条短块（1 个后端块）请求 / When apiFetch 被调用 / Then `timeoutMs` = 20s 基准 + 5s 余量 = 25_000。
- Given 满批 16 条 ×1800 字符（最坏 32 个后端块）请求 / When apiFetch 被调用 / Then `timeoutMs` ≥ 后端公式值（20_000 + 31×2_500 = 97_500），且仍为有界值（= 公式 + 5_000 余量）。

### FR-02: 段被切多块且部分命中缓存时，译文块序与原文块序一致（回归测试钉住）

- 同一送翻段被切为 ≥2 块且部分块命中缓存（LRU/Redis 部分命中）时，译文拼装必须按块的原文产生顺序进行（缓存块与推理块同序混排）；禁止按「命中先填、推理后补」的到达顺序拼装。

#### 场景：主路径

- Given 单段 2400 字符英文（切 3 块，中间块预填缓存）/ When `translate_items` 执行（其余 2 块走假引擎）/ Then 输出 = 块1译文 + 缓存中间块原文译文 + 块3译文，与原文块序逐块对齐。

### FR-03: 引擎重启后旧读线程只写构造时捕获的旧队列，不污染新队列，不产生假崩溃计数

- 读线程必须只写「线程启动时经参数捕获」的队列实例；崩溃重启（`_ensure_started` 换新队列）后，旧读线程的 EOF 哨兵与迟到响应禁止进入新队列（否则被误判 "translate worker exited"/"protocol mismatch" 假崩溃，3 次即 600s 退避）。

#### 场景：主路径

- Given 代理实例的读线程以队列 q1 启动 / When 代理换新队列 q2（`self._responses = q2`）后旧线程收到 EOF / Then EOF 哨兵只出现在 q1，q2 保持为空。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/lib/__tests__/thinking-translate.test.ts「请求超时按批动态计算——短块基准+余量、满批最坏 ≥ 后端公式（97.5s）且含 5s 余量」
FR-02: backend/app/modules/translate/tests/test_service.py「test_partial_cache_hit_keeps_chunk_order」
FR-03: backend/app/modules/translate/tests/test_engine.py「test_reader_writes_only_to_captured_queue」
