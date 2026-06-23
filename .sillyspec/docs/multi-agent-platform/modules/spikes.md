---
schema_version: 1
doc_type: module-card
module_id: spikes
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# spikes

## 定位

multi-agent-platform 的前置技术验证（Spike）集合，位于仓库根 `spikes/`。承载 V1 开工前的强制风险验证：Git 凭据/环境隔离、SillySpec Native Layout 解析、Claude Code 子进程可控性等。性质为一次性 POC，验证通过后其结论被 backend（workspace/agent/git_identity 等模块）吸收实现，spikes 本身不参与生产运行。当前 5 个子目录 + README/REPORT，已全部 PASS（2026-05-25）。

技术栈：Shell（env -i / 临时 HOME / GIT_CONFIG_GLOBAL）、Python（pyyaml/python-frontmatter/pydantic 解析 .sillyspec）、subprocess 拉起 Claude Code CLI。

## 契约摘要

- **入口**：`spikes/README.md`（Spike 清单与执行顺序）、`spikes/REPORT.md`（权威验证报告：结论、关键证据、残留风险）。
- **子 Spike**：
  - `01-git-isolation`：验证单机多用户 Git 凭据/环境隔离（A/B 两套 PAT 互不可见、commit author 正确、push 落对应仓库、临时 HOME 销毁干净）。
  - `02-workspace-scan`：验证 SillySpec Native Layout 可解析、性能可接受（单 workspace ≤200ms、缺字段触发 warning 不崩溃）。
  - `03-claude-code`：验证 Claude Code 子进程可受控（allow-list 工具内动作、隔离 HOME 无越权写入、API key 不泄露日志）。
  - `04-delegate-task`、`05-mission-e2e`：后续追加的任务委派与端到端任务流验证。

## 关键逻辑

- **01 隔离模型**：用 `env -i` + 临时 HOME + `GIT_CONFIG_GLOBAL` + `GIT_ASKPASS` 构造完全隔离执行环境，并发 push 验证互不可见，结束 `shred -u` 销毁临时根。该模型后被 backend git_identity 模块的 `GitIdentityManager` 吸收。
- **02 扫描模型**：纯同步全量扫描 `.sillyspec/projects/*.yaml` 与 `changes/{change,archive}/*`，输出 components/changes/warnings/elapsed_ms。后被 backend workspace 模块的 `WorkspaceScanner` 吸收（V1 形态：同步全量，无须 watcher）。
- **03 子进程模型**：subprocess 启动 Claude Code CLI，限制在指定 workdir、隔离 HOME、环境变量白名单透传、stdout 脱敏。后被 backend agent 模块的 AgentAdapter 启动模板吸收。
- **门禁语义**：README 明示"任何一个不通过，V1 必须暂停"；REPORT 记录 3/3 PASS 解除门禁。

## 注意事项

- Spike 验证是一次性的，REPORT.md 是权威文档，结论/风险/凭据后续动作以此为准。
- Spike 使用的 PAT/API Key 必须在验证后立即撤销（见 REPORT 凭据后续动作）。
- 残留风险（见 REPORT）：Claude Code CLI 升级可能破坏 flag 语义、GLM 与 Anthropic 接口兼容差异、stdout 理论上仍可能漏 key 需正则脱敏。
- 修改 Spike 解析/子进程逻辑要同步检查 backend 对应模块（workspace 的 WorkspaceScanner、agent 的 AgentAdapter、git_identity 的 GitIdentityManager）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
