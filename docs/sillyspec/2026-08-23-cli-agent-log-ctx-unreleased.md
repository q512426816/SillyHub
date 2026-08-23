# sillyspec CLI 会话化上下文已实现未发版 — 工具上报全落「本地活动」兜底桶

- 日期：2026-08-23（发现当日，待 CLI 发版解决）
- 状态：**活跃坑**——源码仓功能已落地（commit 4e4fc6b0），npm 未发版；发版 + 本机更新全局安装后移 `finished/`
- 发现来源：平台 dev 库出现唯一 tool_report 会话 `zcode|`（「zcode · 本地活动」），所有 zcode 日志（含多次 quick 命令）全部聚合进兜底桶，用户看不懂来源

## 现象

- `agent_sessions` 中 `origin='tool_report'` 的会话只有一个，`aggregation_key='zcode|'`（ctx 为空）；
- 挂在其下的 6 条 `platform_agent_logs` 记录 `last_command` 均为 `quick --done ...` 等带会话语境的命令，理应按 quick_id/change_key 分桶，实际全部空 ctx；
- 主仓变更 `2026-08-23-agent-activity-sessions` 的 task-01（CLI 侧 ctx 上报）在 tasks.md 标记 `[x]`，runtime-evidence 六项实证全绿——**但真实环境仍空 ctx**。

## 根因（发版时序缺口，非代码缺陷）

三仓联动的验证方式掩盖了版本缺口：

| 时间（本地） | 事件 |
|---|---|
| 08-23 12:02 | npm 发布 sillyspec **3.27.2**（不含 ctx 功能） |
| 08-23 14:54 | 源码仓 commit `4e4fc6b0`：entry 级 change_key/quick_id + body 级 hub_session_id（task-01） |
| 08-23 16:35 | task-08 端到端实证——**用源码仓直跑 `node src/index.js`**，非 npm 安装包，①④ 项证明按 ctx 分桶后端侧完全正常 |
| 08-23 17:50 | 源码仓 HEAD 前进 6 个提交，**始终未再发版** |
| 08-23 20:21 | 用户真实 quick 命令走 `/opt/homebrew/bin/sillyspec`（npm 3.27.2，无功能）→ 空 ctx → 兜底桶诞生 |

后端 `upsert_agent_log_entries` 按 `(harness, coalesce(change_key, quick_id, ''))` 分组，CLI 不带字段则恒回落单桶——后端行为正确。

## 附带坑：版本号撞车

源码仓 `package.json` 仍为 **3.27.2**，与 npm 上已发布的 3.27.2 同号不同内容。直接 `npm publish` 会被 registry 拒绝（同版本不可重发）——**发版前必须先 bump 到 3.27.3+**。

## 处理建议

1. sillyspec 源码仓（~/Desktop/sillyspec）：处理 `src/agent-session-log.js` 未提交改动 → bump 3.27.3 → `npm publish`；
2. 本机更新全局安装（`npm i -g sillyspec`），之后 `sillyspec agent-log --json` 留底 entries 应见 `change_key`/`quick_id` 字段；
3. dev 库存量兜底桶（本项目未上线可重置）：可不清理——后续上报继续刷新它，真正无 ctx 的杂项命令本来就该落此桶（NFR-02 设计内）；
4. 预期效果：quick 会话命令 → `zcode|quick-<8hex>` 桶（标题 `zcode · quick-<8hex>`）；带 `--change` → `zcode|<变更名>`；无 ctx 杂项（裸 status 等）→ 仍进「本地活动」。

## 流程教训（记录用）

跨仓变更的端到端实证若用源码仓直跑，只能证明"代码正确"，不能证明"用户环境已具备"。涉及 CLI 发版的变更，task 清单应把「npm 发版 + 本机全局安装更新」列为显式收尾步骤，并用 `which sillyspec` 指向的安装包（而非源码仓）做最终一次真实链路验证。
