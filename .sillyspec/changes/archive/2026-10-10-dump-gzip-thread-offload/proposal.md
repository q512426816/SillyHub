---
author: flow-machine-draft
created_at: 2026-10-10T00:27:58.726Z
---
# 提案书（Proposal）— 2026-10-10-dump-gzip-thread-offload

## 动机

任务原话转写：24h 审查发现知识图谱 dump 端点在 async 端点内同步执行 json.dumps + gzip.compress（默认 level 9），大图（实测 5855 节点/MB 级 payload）时阻塞事件循环上全部并发请求（含 SSE 心跳/日志流推送）。
成功标准：
- dump 端点的信封 JSON 序列化与 gzip 压缩必须卸载到工作线程（asyncio.to_thread），事件循环零同步 CPU 段
- 响应字节与响应头（Content-Encoding: gzip / Vary）与卸载前完全一致（行为零变化，既有 4 用例零回归）
- 新增用例先红后绿：gzip.compress 执行线程 ≠ 事件循环线程（旧实现同线程必红）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. dump 端点的信封 JSON 序列化与 gzip 压缩必须卸载到工作线程（asyncio.to_thread），事件循环零同步 CPU 段
2. 响应字节与响应头（Content-Encoding: gzip / Vary）与卸载前完全一致（行为零变化，既有 4 用例零回归）
3. 新增用例先红后绿：gzip.compress 执行线程 ≠ 事件循环线程（旧实现同线程必红）

## 成功标准（可验证）

1. dump 端点的信封 JSON 序列化与 gzip 压缩必须卸载到工作线程（asyncio.to_thread），事件循环零同步 CPU 段
2. 响应字节与响应头（Content-Encoding: gzip / Vary）与卸载前完全一致（行为零变化，既有 4 用例零回归）
3. 新增用例先红后绿：gzip.compress 执行线程 ≠ 事件循环线程（旧实现同线程必红）
