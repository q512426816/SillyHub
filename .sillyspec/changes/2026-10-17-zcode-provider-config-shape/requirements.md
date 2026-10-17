---
author: flow-machine-draft
created_at: 2026-10-17T03:39:40.718Z
---
# 需求规格（Requirements）— 2026-10-17-zcode-provider-config-shape

## 功能需求

### FR-01: buildZcodeProviderConfig 输出形状与宿主有效配置一致（providerConfigRules:{providerRules:[...]} + modelConfigRules:{providerModelRules:[],manualProviderModelRules:[]}），单测钉形状

- `buildZcodeProviderConfig` 返回的 `config.providerConfigRules` **必须**是 `{providerRules:[...]}` 对象包裹（禁止裸数组），且 `config.modelConfigRules` **必须**含 `providerModelRules`/`manualProviderModelRules` 两键——与宿主有效 provider_config.json 及 zcode.cjs 写盘器输出逐字段一致。

#### 场景：主路径

Given 有效 baseUrl/apiKey/model 的 provider
When 调用 buildZcodeProviderConfig
Then 返回对象满足上述形状（单测全等断言钉板）

### FR-02: _applyModel 三路径（精确命中/大小写命中/超时回退）均发送字符串 modelId，单测钉超时回退路径

- `_applyModel` 在目录精确命中、大小写命中、目录超时三条路径上都**必须**以字符串 `modelId` 发送 `session/setModel`（禁止发送 `modelId:undefined`）；目录命中且条目带 reasoningLevels 时还**必须**附带 `options.reasoningLevel`（引擎自报 `reasoningDefaultLevel` ?? 末档）。

#### 场景：主路径

Given start opts.model='GLM-5.3' 且引擎推送目录条目 modelId='glm-5.3'（levels=[low,high,max], defaultLevel=max）
When _applyModel 执行
Then setModel 参数为 `{providerId:'sillyhub', modelId:'glm-5.3', options:{reasoningLevel:'max'}}`（单测钉板）

### FR-03: 单测全绿（zcode-settings + zcode driver 相关）

- 本变更触碰的测试文件（zcode-settings.test.ts / zcode-app-server-driver.test.ts / zcode-events.test.ts）**必须**全部通过（vitest run 三文件 42 用例零红）。

#### 场景：主路径

When `pnpm vitest run <三文件>` 与 `pnpm typecheck`
Then 全部通过、无类型错误

### FR-04: 重建 bundle 安装到本机 daemon 并重启，生产后端实测：新建 zcode 会话发一轮消息，turn 完成、回复落库渲染、模型路由走 SillyHub provider（daemon.log 无 Provider Registry/Select a model 错误）

- 生产实测链路**必须**满足：新建 zcode 会话首问后 run `completed` 且 exit=0，`llm_provider_id` 等于绑定的平台供应商 id，daemon 侧无「Provider Registry 中不存在 Model」「Reasoning level is required」「Select a model before continuing」任一错误（2026-10-17 会话 687ac4e1/1d9ebb72/ae34976e 三轮实证）；dsh 引擎同法实测一轮 completed（会话 9e4d4989）。

#### 场景：主路径

Given 新 bundle 已安装且 daemon 重启完成
When 经 POST /api/daemon/sessions 创建 zcode（及 dsh）会话发一轮消息
Then run completed、tokens 消费为真值、无上述错误日志

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/zcode-settings.test.ts「schemaVersion=1 + providerOrder + providerRules 对象包裹 + modelConfigRules 两键（逐字段对齐宿主有效实例）」
FR-02: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「create → subscribe → setModel → 乒乓一轮全链路（帧形状钉板）」
FR-03: sillyhub-daemon/tests/zcode-settings.test.ts + tests/interactive/zcode-app-server-driver.test.ts + tests/interactive/zcode-events.test.ts（vitest run 三文件 42 用例）
FR-04: 不适用：生产后端实测（POST /api/daemon/sessions + runs API 对账），无自动化测试面——实证记录见本文 FR-04 场景与 flow ledger
