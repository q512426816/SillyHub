---
author: flow-machine-draft
created_at: 2026-10-17T07:57:35.098Z
---
# 需求规格（Requirements）— 2026-10-17-dsh-rc2-protocol-fix

## 功能需求

### FR-01: session/new 恒带 mcpServers:[] 占位（rc.2 必填、旧版兼容），探针验证握手通过

- 驱动对 dsh 0.2.0-rc.2 的 session/new **必须**携带 `mcpServers`（空数组占位）；set_config_option **必须**用扁平 `{sessionId, configId, value}` 形状；设置失败**必须**降级 warn 非致命（禁止终止会话）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-02: set_config_option 改扁平形状（configId=model/reasoning_effort），设置失败降级 warn 非致命（不再杀会话），单测钉新形状

- 驱动对 dsh 0.2.0-rc.2 的 session/new **必须**携带 `mcpServers`（空数组占位）；set_config_option **必须**用扁平 `{sessionId, configId, value}` 形状；设置失败**必须**降级 warn 非致命（禁止终止会话）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-03: 驱动失败路径留痕：握手里程碑、consume failed 原因、子进程退出，daemon.log 可见

- 驱动对 dsh 0.2.0-rc.2 的 session/new **必须**携带 `mcpServers`（空数组占位）；set_config_option **必须**用扁平 `{sessionId, configId, value}` 形状；设置失败**必须**降级 warn 非致命（禁止终止会话）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-04: dsh 驱动相关单测全绿（15 用例）；typecheck 干净

- 驱动对 dsh 0.2.0-rc.2 的 session/new **必须**携带 `mcpServers`（空数组占位）；set_config_option **必须**用扁平 `{sessionId, configId, value}` 形状；设置失败**必须**降级 warn 非致命（禁止终止会话）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: tests/interactive/dsh-acp-driver.test.ts「model + thinkingLevel=medium → set_config_option 扁平形状(configId=model/reasoning_effort)；off → 不发档位」
FR-02: tests/interactive/dsh-acp-driver.test.ts（15 用例全绿）
FR-03: 不适用：诊断留痕为生产面 console 线（真机 UI 复现验证），无单测面
FR-04: 不适用：typecheck 为命令级实测（pnpm typecheck）
