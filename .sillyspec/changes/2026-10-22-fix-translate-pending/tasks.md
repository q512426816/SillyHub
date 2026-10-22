---
author: flow-machine-draft
created_at: 2026-10-22T01:21:32.515Z
---
# 任务注册表（Tasks）— 2026-10-22-fix-translate-pending

- [x] task-01: 前端 thinking-translate.ts 的 requestBatch 传 timeoutMs=20000；thinking-translate.test.ts 新增「请求参数含 20s 超时」与「超时异常 → null + 60s 退避」用例，跑该文件测试全绿
- [x] task-02: config.py 新增 translate_request_timeout_sec（默认 20.0，env TRANSLATE_REQUEST_TIMEOUT_SEC）；engine.py 构造参数 request_timeout_sec 替代固定 REQUEST_TIMEOUT_SEC 常量；test_engine.py 新增超时可配置 + 超时 fail-soft 用例，跑 translate 模块测试全绿
- [x] task-03: engine.py 子进程 stderr 由后台线程逐行写入 logger（WARNING），移除 DEVNULL；test_engine.py 新增 stderr 留痕用例（假 worker 写 stderr，caplog 断言），跑该文件测试全绿
- [x] task-04: deploy/docker-compose.yml 增加 ./models/opus-mt-en-zh 挂载与 TRANSLATE_MODEL_DIR 透传；README 补超时配置、stderr 日志、预置模型部署说明
- [x] task-05: 生产服务器经 hf-mirror 下载 ct2 模型到 deploy/models/opus-mt-en-zh，.env 设 TRANSLATE_MODEL_DIR，重建 backend；容器内真模型 worker 冒烟产出中文，公网接口验证 engine_ready=true
