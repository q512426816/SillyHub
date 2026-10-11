# SPIKE-01 留档：codex app-server MCP 生效实测（task-02）——受阻裁定

- 实测日期：2026-10-11
- 结论：**未能实测（宿主引擎不可用）——codex.mcp 维持 false，复评条件留档**（循 D-011@v1 执行期裁决与 D-006 红线"禁止无实测证据翻值"）

## 受阻原因链

1. 宿主 codex CLI 存在但损坏：`codex --version` 报 `Missing optional dependency @openai/codex-win32-x64`（sillyhub-daemon/src/interactive/codex-app-server-driver.ts:820 依赖的 `codex app-server --listen stdio://` 无法启动）
2. 修复尝试全数失败（网络限断）：
   - `npm i -g @openai/codex@latest`：主包更新成功（changed 1 package）但平台二进制 optional dependency 静默跳过
   - `npm i -g @openai/codex-win32-x64@0.162.0`（官方 registry）：`ETIMEDOUT 141.193.154.210:443`（npmjs 直连被限断）
   - npmmirror 镜像：`[NOT_FOUND] @openai/codex-win32-x64 not found`（镜像未同步该包）
   - yarnpkg registry tarball 直链：下载失败（连接中断）
   - curl 直链两 registry：均失败（npmmirror NoSuchKey / npmjs 被透明拦截返回非 tarball）

## "未能实测"与"实测不生效"的区分（D-011@v1 核心）

两者都不得翻 caps，但处置不同：
- 实测不生效 → 通道截断，注释记坑点，复评条件=上游修复
- 未能实测（本例）→ **机制代码照计划交付**（codex-settings.ts [mcp_servers.*] 托管段序列化 + 往返单测——纯 TOML 逻辑不依赖引擎可运行），caps 维持 false；引擎修复后重跑本 SPIKE（实测 app-server 模式下 config.toml MCP 工具面可见性），通过即翻值——机制就绪状态使复评成本最小化（翻值 = 单键改 false→true + 重跑 gen-provider-caps）

## 复评条件（SOP）

1. 修复宿主 codex：`npm install -g @openai/codex@latest`（需平台二进制可下载的网络环境），`codex --version` 正常输出
2. 重跑本 SPIKE 实测：临时 CODEX_HOME 写 `[mcp_servers.spike_test]`（stdio echo server）→ `codex app-server --listen stdio://` initialize（capabilities.experimentalApi=true）→ thread/start 枚举工具面
3. 工具面可见 → providers.ts codex.mcp 翻 true + 注释更新实测证据；不可见 → 评估 initialize capabilities 实验位，仍不通则维持 false 并记坑点

## 对 task-06 的影响

- 按 task-06 卡"截断分支"执行：codex-settings.ts 托管段扩展 + codex-settings-mcp.test.ts 照常交付（acceptance 允许"按截断分支留档"）；providers.ts codex 注释更新为"未能实测（引擎不可用）+ 复评 SOP 引用本文件"
