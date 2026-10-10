---
author: flow-machine-draft
created_at: 2026-10-10T00:27:58.726Z
---
# 需求规格（Requirements）— 2026-10-10-dump-gzip-thread-offload

## 功能需求

### FR-01: dump 端点的信封 JSON 序列化与 gzip 压缩必须卸载到工作线程（asyncio.to_thread），事件循环零同步 CPU 段

- `GET /knowledge/graph/dump` 端点必须将信封 JSON 序列化（json.dumps）与 gzip 压缩（gzip.compress）整体放入单个同步函数并经 `asyncio.to_thread` 执行，禁止在事件循环线程同步执行该 CPU 段。

#### 场景：主路径

Given 大图（>100KB payload）dump 请求 / When 端点处理 / Then gzip.compress 在工作线程执行（spy 线程 id ≠ 事件循环线程 id），事件循环期间可调度其它请求。

### FR-02: 响应字节与响应头（Content-Encoding: gzip / Vary）与卸载前完全一致（行为零变化，既有 4 用例零回归）

- 卸载后响应必须保持 Content-Encoding: gzip 与 Vary: Accept-Encoding 响应头，压缩字节与卸载前一致（同函数同参数，仅执行线程变化）；既有 dump 组用例（happy path/大 payload 压缩生效/不可用小包同构/压缩面未外溢）必须零回归。

#### 场景：主路径

Given 卸载后实现 / When 复跑 dump 组既有用例 / Then 全绿（6/6，含新增卸载钉）。

### FR-03: 新增用例先红后绿：gzip.compress 执行线程 ≠ 事件循环线程（旧实现同线程必红）

- 测试必须以 spy 记录 gzip.compress 执行线程 id，断言 ≠ 测试事件循环线程；实现前运行必须红（1 failed），实现后必须全绿。

#### 场景：主路径

Given 未卸载的旧实现 / When 跑新增用例 / Then 红（compress 在事件循环线程）。
Given to_thread 卸载后 / When 同用例 / Then 绿。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/knowledge/tests/test_graph.py「test_graph_dump_compress_offloaded_to_worker_thread」
FR-02: backend/app/modules/knowledge/tests/test_graph.py「test_graph_dump_happy_path_gzip_envelope」+「test_graph_dump_large_payload_compression_effective」（dump 组 5 旧用例零回归，实测 6 passed 2026-10-10 08:26）
FR-03: backend/app/modules/knowledge/tests/test_graph.py「test_graph_dump_compress_offloaded_to_worker_thread」（先红 1 failed 实证于 2026-10-10 08:25 运行，后绿 6/6 实证于 08:26 运行）
