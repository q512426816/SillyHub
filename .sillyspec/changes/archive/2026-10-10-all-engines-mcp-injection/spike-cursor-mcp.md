# SPIKE-02 留档：cursor headless MCP 实测（task-03）——受阻裁定

- 实测日期：2026-10-11
- 结论：**未能实测（宿主无 cursor-agent CLI 且网络无法安装）——cursor.mcp 维持 false，复评条件留档**（循 D-011@v1 执行期裁决与 D-003 红线"禁止无实测证据翻值"）

## 受阻原因链

1. 宿主只有 Cursor IDE 桌面版（`C:/Users/qinyi/AppData/Local/Programs/cursor/`），无 `cursor-agent` CLI（`command not found`；npm 全局清单无 cursor 相关包）
2. cursor-agent 官方安装通道（cursor.com/install 安装脚本 / npm）在当前网络环境下不可达（与 SPIKE-01 同源网络限断，见 spike-codex-mcp.md 受阻原因链第 2 条）
3. 既有注释依据仍成立：cursor-agent CLI 无 per-session `--mcp-config` 通道（sillyhub-daemon/src/interactive/cursor-driver.ts:22/95，D-008@v1 定档）；上游社区反馈 headless 模式 MCP 工具审批未实现（CI 场景工具调用可能挂起）——本次未能实测无法推翻或确认该反馈

## 上游坑点记录（来自社区反馈，未经本地实测验证）

- cursor-cli 在 CI/headless 环境下 MCP 工具审批机制未实现：server 可能加载但工具调用挂起或失败（Cursor Forum 多帖反馈）
- 缓解线索（复评时优先验证）：`--trust` / `--force` 参数（cursor-driver.ts:241-258 buildTurnArgs 现用）是否跳过 MCP 工具审批

## 配置落点调查（静态结论，待复评实测确认）

- 全局 `~/.cursor/mcp.json`：宿主用户资产，daemon 禁止写入（全局硬约束）
- 项目级 `.cursor/mcp.json`：落 workspace 目录会污染宿主直接使用同一目录（全局硬约束）
- per-process 隔离：cursor-agent 是否支持 `CURSOR_CONFIG_DIR` 类 env 或 per-process 配置参数——未实测，复评时验证；无隔离通道则 cursor 通道结构性不可行（除非上游提供 per-session MCP 参数）

## 复评条件（SOP）

1. 安装 cursor-agent CLI（网络可达 cursor.com/install 时）
2. 实测审批行为：临时目录 mcp.json 配 stdio echo server → `cursor-agent -p --output-format stream-json --trust --force` 观察工具调用是否自动批准
3. 实测落点隔离：验证 per-process 配置参数/env 是否存在且生效
4. 两项通过 → providers.ts cursor.mcp 翻 true + driver 消费实现；任一不过 → 维持 false，注释更新实测证据

## 对 task-07 的影响

走 task-07 卡"不可行分支"：providers.ts cursor 注释块改写为实测证据（本文件）/坑点（headless 审批未实现反馈+落点隔离缺失）/复评条件（本 SOP）三要素；cursor-driver.ts 忽略注释同步更新。
