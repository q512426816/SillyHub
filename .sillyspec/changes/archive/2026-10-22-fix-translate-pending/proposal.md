---
author: flow-machine-draft
created_at: 2026-10-22T01:21:32.514Z
---
# 提案书（Proposal）— 2026-10-22-fix-translate-pending

## 动机

任务原话转写：生产 /api/translate/thinking 请求长时间 pending：容器未配置 TRANSLATE_MODEL_DIR 且 huggingface.co 不可达，worker 子进程卡在模型下载，主进程要等 300 秒；前端 POST 请求无超时，界面一直「翻译中」不收敛

成功标准：
- 前端该 POST 请求带显式超时（20s），超时按引擎不可用处理并进入退避，界面不再无限等待
- 后端子进程请求超时改为可配置且默认收紧到 20s（现 300s），超时 fail-soft 返回原文
- worker 子进程 stderr 落盘可查（含模型下载/加载失败原因），不再丢进 DEVNULL
- 生产服务器预置 opus-mt-en-zh 模型目录并配置 TRANSLATE_MODEL_DIR，接口返回 engine_ready=true 且英文思考文本译文含中文
- 相关测试通过：后端 translate 模块测试、前端 thinking-translate 测试

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 前端该 POST 请求带显式超时（20s），超时按引擎不可用处理并进入退避，界面不再无限等待
2. 后端子进程请求超时改为可配置且默认收紧到 20s（现 300s），超时 fail-soft 返回原文
3. worker 子进程 stderr 落盘可查（含模型下载/加载失败原因），不再丢进 DEVNULL
4. 生产服务器预置 opus-mt-en-zh 模型目录并配置 TRANSLATE_MODEL_DIR，接口返回 engine_ready=true 且英文思考文本译文含中文
5. 相关测试通过：后端 translate 模块测试、前端 thinking-translate 测试

## 成功标准（可验证）

1. 前端该 POST 请求带显式超时（20s），超时按引擎不可用处理并进入退避，界面不再无限等待
2. 后端子进程请求超时改为可配置且默认收紧到 20s（现 300s），超时 fail-soft 返回原文
3. worker 子进程 stderr 落盘可查（含模型下载/加载失败原因），不再丢进 DEVNULL
4. 生产服务器预置 opus-mt-en-zh 模型目录并配置 TRANSLATE_MODEL_DIR，接口返回 engine_ready=true 且英文思考文本译文含中文
5. 相关测试通过：后端 translate 模块测试、前端 thinking-translate 测试
