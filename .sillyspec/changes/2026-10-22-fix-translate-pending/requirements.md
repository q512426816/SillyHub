---
author: flow-machine-draft
created_at: 2026-10-22T01:21:32.514Z
---
# 需求规格（Requirements）— 2026-10-22-fix-translate-pending

## 功能需求

### FR-01: 前端该 POST 请求带显式超时（20s），超时按引擎不可用处理并进入退避，界面不再无限等待

- 前端 `requestBatch` 调用 `/api/translate/thinking` 时必须传 `timeoutMs=20000`；超时异常必须与网络失败同语义——本批条目全部回退原文（resolve null），并写入 60s 不可用退避窗口，禁止让请求无限挂起。

#### 场景：超时降级

- Given 后端翻译子进程卡在模型下载，20 秒内不返回响应
- When 前端合批请求触发
- Then `apiFetch` 在第 20 秒 abort 并抛 `code=timeout`，本批思考内容展示原文，60 秒内不再发起新请求

#### 场景：正常返回不受影响

- Given 后端在 20 秒内返回 `engine_ready=true` 译文
- When 前端收到响应
- Then 超时机制不介入，译文照常回填并写入缓存

### FR-02: 后端子进程请求超时改为可配置且默认收紧到 20s（现 300s），超时 fail-soft 返回原文

- `TranslateSubprocessProxy` 必须支持构造参数 `request_timeout_sec`（缺省读取 `settings.translate_request_timeout_sec`，环境变量 `TRANSLATE_REQUEST_TIMEOUT_SEC`，默认 `20.0`）；等待子进程响应超过该值必须按崩溃处理并 fail-soft 返回原文，禁止沿用固定的 300 秒。实际等待预算必须按批大小线性放宽（每条 +2.5s，满批 16 条约 57.5s）——16×1000 字符满批在 2 核生产机实测 21.5s，单一 20s 定值会误杀正常推理并累计崩溃计数。

#### 场景：慢子进程触发 fail-soft

- Given worker 子进程在超时窗内无任何响应行
- When `translate()` 等待超时
- Then 抛出 `TranslateSubprocessError`，`service.translate_items` 捕获后返回 `engine_ready=false` + 原文透传，HTTP 状态仍为 200

#### 场景：正常推理不误杀

- Given 预置模型已加载、单批推理在 20 秒内完成
- When `translate()` 正常收到响应
- Then 返回译文，崩溃计数归零

### FR-03: worker 子进程 stderr 落盘可查（含模型下载/加载失败原因），不再丢进 DEVNULL

- `TranslateSubprocessProxy` 启动子进程时禁止把 stderr 指向 DEVNULL；必须用后台线程逐行读取并写入主进程 logger（`app.modules.translate.engine`，WARNING 级），使模型下载/加载失败原因可查。

#### 场景：模型下载失败留痕

- Given worker 因 HuggingFace 不可达而失败退出
- When 主进程读线程收到 stderr 行
- Then 后端日志出现该行内容（含错误原因），且读线程异常不影响请求处理

### FR-04: 生产服务器预置 opus-mt-en-zh 模型目录并配置 TRANSLATE_MODEL_DIR，接口返回 engine_ready=true 且英文思考文本译文含中文

- `deploy/docker-compose.yml` 必须把 `./models/opus-mt-en-zh` 挂载到容器 `/opt/models/opus-mt-en-zh`，并透传环境变量 `TRANSLATE_MODEL_DIR`（默认空）；生产 `.env` 必须设为 `/opt/models/opus-mt-en-zh` 且服务器该目录已放置完整 ct2 模型；重启后 `POST /api/translate/thinking` 必须返回 `engine_ready=true` 且英文思考文本译文含中文。

#### 场景：生产零下载加载

- Given 服务器 `deploy/models/opus-mt-en-zh` 含 `config.json` 与模型文件，`.env` 已设 `TRANSLATE_MODEL_DIR`
- When backend 容器重建并收到英文翻译请求
- Then worker 直接加载本地目录（无 HF 请求），接口返回中文译文

#### 场景：目录缺失时保持 fail-soft

- Given 模型目录缺失
- When 收到翻译请求
- Then 20 秒内 fail-soft 返回原文，不阻塞界面

### FR-05: 相关测试通过：后端 translate 模块测试、前端 thinking-translate 测试

- 后端 translate 模块测试与前端 thinking-translate 测试必须全部通过，新增用例覆盖超时参数、超时降级与 stderr 日志三个行为面。

#### 场景：主路径

- Given 代码与用例已落盘
- When 分别运行后端 translate 测试与前端该文件测试
- Then 全部通过

## 测试绑定

FR-01: frontend/src/lib/__tests__/thinking-translate.test.ts「translateText 请求带 20s 超时并可被超时降级」
FR-02: backend/app/modules/translate/tests/test_engine.py「request_timeout_sec 可配置且超时 fail-soft」
FR-03: backend/app/modules/translate/tests/test_engine.py「worker stderr 进入主进程日志」
FR-04: 不适用：生产部署操作项，由服务器容器内真模型 worker 冒烟 + 接口验证（非自动化测试）
FR-05: 不适用：本条本身即测试执行要求，由 flow done 实测门对账
