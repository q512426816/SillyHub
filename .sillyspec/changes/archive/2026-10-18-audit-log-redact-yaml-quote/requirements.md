---
author: flow-machine-draft
created_at: 2026-10-18T07:48:05.717Z
---
# 需求规格（Requirements）— 2026-10-18-audit-log-redact-yaml-quote

## 功能需求

### FR-01: zcode 驱动 env 诊断日志的值统一走脱敏 helper：KEY/TOKEN 键整值 <redacted>，其余值内 scheme://user:pass@host 形态的 userinfo 段打码为 ***，普通值原样保留（诊断能力不回退）

- zcode 驱动 spawn 前的 env 诊断日志**必须**经统一脱敏函数输出：键名含 KEY/TOKEN 的值整值替换为 `<redacted>`；其余值中 `scheme://userinfo@host` 形态的 userinfo 段**必须**打码为 `***`（保留 scheme 与 host 供诊断定位）；不含凭据形态的值**禁止**改写（既有截断 60 字符语义保留）。

#### 场景：代理 URL 凭据打码

Given env 含 `HTTPS_PROXY=http://user:secret@proxy.example.com:3128` 与 `ANTHROPIC_BASE_URL=https://api.example.com`
When zcode 会话 spawn 打印 env 诊断日志
Then 日志中代理值为 `http://***@proxy.example.com:3128`，BASE_URL 值原样保留。

#### 场景：KEY/TOKEN 整值脱敏

Given env 含 `ANTHROPIC_API_KEY=sk-xxx` 与 `ANTHROPIC_AUTH_TOKEN=tok-yyy`
When 同上
Then 日志中两键的值均为 `<redacted>`，密钥本体不落日志。

### FR-02: dsh cordis.patch.yml 的 model id/name 与 baseURL 一律 YAML 单引号包裹并按规范双写转义内嵌单引号，含冒号/空格/#/单引号的模型名不再破坏 YAML 结构

- writeDshHome 生成的 cordis.patch.yml 中 model id、model name 与 baseURL **必须**以 YAML 单引号标量输出（内嵌单引号按规范双写转义）；**禁止**对这三个插值字段做裸插值。api/apiKeyEnv/providerId/displayName 为代码内常量枚举，维持现状。

#### 场景：特殊字符模型名

Given provider 的 model 含 `: `（键值分隔）、`#`（注释起始）、`'`（单引号）等 YAML 特殊字符
When writeDshHome 写盘
Then patch 中该值被单引号包裹且内嵌单引号双写转义，YAML 结构不破坏（不产生多余键/注释吞噬后续行）。

#### 场景：常规值幂等

Given provider 为常规形态（model=deepseek-v4、baseURL=https://api.example.com/anthropic）
When writeDshHome 写盘
Then 输出为 `'deepseek-v4'` / `'https://api.example.com/anthropic'` 形态，同配置二次写内容一致（幂等语义不变）。

### FR-03: 新增单测钉板两处（zcode 脱敏 helper 纯函数用例 + dsh 特殊字符模型名写盘用例），既有用例断言同步更新，dsh-settings 与 zcode 驱动相关测试全绿，tsc 零错

- **必须**新增 zcode 脱敏函数纯函数用例（代理凭据打码 / KEY-TOKEN 整值脱敏 / 普通值透传三态）与 dsh 特殊字符模型名写盘用例；既有 dsh-settings 用例断言**必须**同步更新为引号形态；dsh-settings 与 zcode 驱动相关测试**必须**全绿，daemon typecheck **必须**零错。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「redactEnvValueForLog 脱敏三态（代理 userinfo 打码/KEY-TOKEN 整值 <redacted>/普通值透传）」
FR-02: sillyhub-daemon/tests/dsh-settings.test.ts「特殊字符模型名/URL 单引号转义不破坏 YAML」
FR-03: sillyhub-daemon/tests/dsh-settings.test.ts「writeDshHome（per-session 路由写盘）」既有用例更新 + `pnpm -C sillyhub-daemon typecheck` 零错
