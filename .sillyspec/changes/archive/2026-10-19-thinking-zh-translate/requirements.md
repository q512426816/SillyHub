---
author: flow-machine-draft
created_at: 2026-10-19T05:30:09.503Z
---
# 需求规格（Requirements）— 2026-10-19-thinking-zh-translate

## 功能需求

### FR-01: 会话思考内容默认显示中文译文，可一键切回原文；折叠摘要流式结束后亦译为中文

- 展开态正文必须默认渲染中文译文（译文到达前先显示原文 + 「翻译中」标记，译文到达后替换，避免布局跳变）；展开区必须提供「译文/原文」一键切换（切换仅影响当前组件实例，不写全局偏好）。
- 折叠态摘要必须在流式结束后（或静态回放内容挂载时）译为中文；流式进行中摘要显示原文（此时有「思考中」脉冲标记，不发翻译请求）。
- 已是中文为主（CJK 占比 ≥ 60%）或过短（压平后 < 30 字符）的思考文本必须跳过翻译，原样展示（前后端双重判定，前端跳过不发请求）。
- 翻译偏好必须持久化到 localStorage（默认开启），关闭后所有思考内容回退原文展示且不发请求。

#### 场景：展开查看译文

Given 一条英文思考内容已流式完成，When 用户展开思考折叠块，Then 正文默认显示中文译文（未就绪时短暂显示原文 + 翻译中标记），且提供「显示原文」切换。

#### 场景：流式中不发请求

Given 思考内容正在流式增量到达，When 折叠摘要实时更新，Then 不发起任何翻译请求（摘要显示原文 + 思考中脉冲）；流结束后摘要自动换为中文。

#### 场景：中文内容跳过

Given 思考文本以中文为主，When 渲染，Then 直接展示原文，不发起翻译请求。

#### 场景：模型不可用降级

Given 后端翻译模型未就绪，When 用户展开思考块，Then 显示原文并出现一次性的「离线翻译未就绪」轻提示，后续请求按退避节流。

### FR-02: 翻译为本地离线推理（后端 CTranslate2 + opus-mt-en-zh int8 量化模型，首用自动下载、可配置本地目录），全程无外部云翻译 API 调用

- 翻译推理必须在后端本地子进程内完成（CTranslate2 int8 量化 opus-mt-en-zh），禁止调用任何外部云翻译 API（无百度/谷歌/DeepL 等网络调用）。
- 模型必须支持环境变量配置本地目录（TRANSLATE_MODEL_DIR 指向预置模型，离线部署零下载）；未配置时首用从 HuggingFace 自动下载（尊重 HF_ENDPOINT 镜像变量），下载或加载失败必须 fail-soft（端点返回 engine_ready=false，不抛 5xx、不阻塞应用启动）。
- 翻译子进程必须遵循既有 embedding worker 三闸自灭模式：闲置自灭、父进程消失自灭、硬寿命帽；崩溃进入退避不烧 CPU。
- 围栏代码块（```）、行内代码、URL 必须原样保留不送翻（送翻的只是自然语言段落）。

#### 场景：离线部署

Given 部署环境无外网且已预置模型目录（TRANSLATE_MODEL_DIR），When 前端请求翻译，Then 本地推理正常返回译文。

#### 场景：模型缺席

Given 模型未下载且无法联网，When 前端请求翻译，Then 返回 200 + engine_ready=false + 原文透传，前端降级显示原文。

### FR-03: 性能可控：按需触发（用户展开或流式结束后）、文本分块并发、译文缓存（内存 LRU + Redis），不阻塞会话流式渲染；模型不可用时优雅降级显示原文

- 翻译必须仅在用户可见时机触发：折叠摘要（流结束/静态挂载）与展开正文（展开时）；翻译失败或不可用时必须不阻塞、不重试风暴（指数退避）。
- 长文本必须按自然段分块（≤1000 字符/块送翻，前端请求批量 ≤16 条/次）后再按序拼接，保持段落边界完整。
- 译文必须缓存：后端内存 LRU（条目上限可配）+ Redis best-effort 层（TTL 7 天，Redis 缺席静默跳过）；同文本重复请求必须命中缓存零推理。
- 前端必须实现模块级请求合并：同屏多条摘要翻译合批为单请求（250ms 窗口聚合），相同文本跨组件共享单次在途请求。
- 会话 SSE 流式渲染路径必须零改动零阻塞：翻译请求独立于流通道，不占用流连接。

#### 场景：同屏多思考块

Given 「全部」视图一次挂载 10 个思考折叠块，When 流已结束，Then 10 条摘要翻译合并为 1 个批量请求（单次网络往返）。

#### 场景：缓存命中

Given 同一思考文本第二次被请求（刷新页面/重新展开），When 后端收到请求，Then LRU/Redis 命中直接返回，不触发模型推理。

#### 场景：超长思考

Given 单条思考 20000 字符，When 用户展开，Then 前端按段分块多请求按序渲染，不出现整条超时。

### FR-04: 覆盖三条思考渲染路径：daemon 会话面板时间线、AgentLogViewer、agent-logs 回放卡

- 三条路径的思考渲染必须统一接入同一翻译组件/hook（单一实现，禁止三份拷贝逻辑）：daemon 会话面板（ThinkingRowView + TurnDetailsList 思考组）、AgentLogViewer 思考折叠块、agent-logs 回放卡思考段。
- 移动端会话页（复用 SessionPanel 组件）必须随组件接入自动获得同等能力，不单独开发。
- 三条路径的降级行为必须一致：翻译不可用一律回退原文展示，不出现空白或报错弹窗。

#### 场景：三路径一致

Given 翻译引擎正常，When 分别在会话面板、AgentLogViewer、回放卡查看英文思考，Then 三处均默认中文展示且可切原文。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/translate/tests/test_router.py「test_translate_endpoint_requires_auth」
FR-01: frontend/src/lib/__tests__/thinking-translate.test.ts「needsTranslation 启发式（中文为主/过短零请求）」
FR-01: frontend/src/components/thinking-translate/__tests__/translated-thinking.test.tsx「偏好关闭 → off 零请求（回退原文不发请求）」
FR-01: frontend/src/components/thinking-translate/__tests__/translated-thinking.test.tsx「展开默认译文 + 一键切原文」
FR-02: backend/app/modules/translate/tests/test_engine.py「fake worker 子进程协议/崩溃退避/透明重启」
FR-02: backend/app/modules/translate/tests/test_router.py「engine 不可用 fail-soft 返回 engine_ready=false」
FR-02: backend/app/modules/translate/tests/test_chunking.py「代码块/行内代码/URL 保护不送翻」
FR-03: backend/app/modules/translate/tests/test_service.py「LRU 缓存命中与淘汰」
FR-03: frontend/src/lib/__tests__/thinking-translate.test.ts「合批队列与同文本去重」
FR-03: backend/app/modules/translate/tests/test_chunking.py「长文按段分块边界」
FR-04: frontend/src/components/daemon/__tests__/turn-segment-views-thinking-translate.test.tsx「ThinkingRowView 接入翻译」
