# vendored pi extensions

本目录存放随 SillyHub daemon 分发的 pi 扩展（pi 本体不带这些扩展）。分两类：
`@earendil-works/pi-coding-agent` 包内 `examples/extensions/` 示例扩展的**快照拷贝**
（subagent），与 SillyHub **自研扩展**（ask-user，源码即本目录，无上游快照）。

## 目录内容与来源

| 目录 | 来源 | 用途 |
|---|---|---|
| `subagent/` | pi 0.81.1 包内 `examples/extensions/subagent/` 快照（index.ts + agents.ts + 样例 agents/prompts） | subagent 工具：模型可委派任务给子代理（每个子代理是独立 `pi --mode json -p --no-session` 子进程） |
| `ask-user/` | SillyHub 自研（ql-20260911-027-13b6） | `AskUserQuestion` 工具：模型可调的用户提问（内部 `ctx.ui.select/input` → RPC 模式 `extension_ui_request` → daemon 桥接 → 平台弹窗卡）。pi 本体无任何模型可调的提问工具，不装载则 pi 会话只能文字罗列问题 |

## 为什么 vendor（而不是运行时解析包内路径）

R-02（2026-09-04-provider-pi-onboarding）：`examples/` 不是 pi 的稳定
公开 API 面——npm 安装位置（如 nvm 目录）与内容随版本漂移，运行时解析
包内绝对路径极度脆弱。vendor 进 daemon 分发目录后随 daemon 版本钉住，
pi 升级不改变本拷贝。

## 版本脆弱性说明（重要）

- 拷贝时点：pi **0.81.1**（2026-09-04，task-06）。
- pi 的扩展加载器（`dist/core/extensions/loader.js`）用 jiti 加载 .ts 扩展，
  并把 `@earendil-works/*`、`typebox` 等导入映射到**当前运行中的 pi 实例**
  （virtualModules/aliases）——vendored 拷贝不需要自带 node_modules，但
  扩展代码调用的 ExtensionAPI 面与已装 pi 版本强耦合：pi 大版本升级后
  扩展可能加载失败（pi 启动诊断报 extension 错误，官方提示用 `-ne` 规避）。
- 缓解：
  - 环境变量 `SILLYHUB_PI_SUBAGENT_EXTENSION=off` / `SILLYHUB_PI_ASK_USER_EXTENSION=off`
    可分别禁用装载（见 `src/interactive/pi-rpc-driver.ts` 的
    `piVendoredSubagentExtensionPath` / `piVendoredAskUserExtensionPath`）；
  - 文件缺失时 driver 静默跳过 `--extension` 参数（会话本身不受影响）。
- 刷新流程：pi 升级后重拷 `examples/extensions/subagent/` 覆盖本目录（ask-user
  是自研件按 ExtensionAPI 面适配修正）→ 跑 `tests/interactive/pi-rpc-driver.test.ts`
  + 真实 pi 会话冒烟（工具可用性以 `docs/agent-provider-onboarding.md` §5 PI 案例
  锚的实测步骤复核）。

## 分发

`scripts/build-bundle.sh` 会把本目录整体拷进 `build/bundle/vendor/`（与
`mcp-server.js` 同级的运行时伴生文件先例）；driver 在 spawn 时对每个扩展以
`--extension <本目录下 <名>/index.ts 绝对路径>` 装载（subagent 与 ask-user
各一个 flag，pi CLI 支持多次 `--extension`）。
