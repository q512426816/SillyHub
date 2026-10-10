---
author: flow-machine-draft
created_at: 2026-10-10T00:27:58.726Z
---
# 任务注册表（Tasks）— 2026-10-10-dump-gzip-thread-offload

- [x] task-01: dump 端点的信封 JSON 序列化与 gzip 压缩必须卸载到工作线程（asyncio.to_thread），事件循环零同步 CPU 段
- [x] task-02: 响应字节与响应头（Content-Encoding: gzip / Vary）与卸载前完全一致（行为零变化，既有 4 用例零回归）
- [x] task-03: 新增用例先红后绿：gzip.compress 执行线程 ≠ 事件循环线程（旧实现同线程必红）
