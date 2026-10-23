---
name: sillyspec:config
description: 用于 SillySpec local.yaml 配置引导。适合用户说"配置下 sillyspec、连接平台、配 MCP、lint 不跑、测试太慢、加豁免"或 agent 需要写 .sillyspec/local.yaml 时。核心原则：默认零配置可用，只写真需要的键，写完必须 config validate 通过。
---

## 何时使用

- 用户要求配置 SillySpec（平台凭据/MCP/测试/lint/调优键）
- agent 判断需要写 `.sillyspec/local.yaml`（任何场景——本技能是唯一引导面）

## 第一原则：默认零配置可用（先读这段再动手）

**local.yaml 一个键都不写，SillySpec 就是完整可用的。** 全部 ~70 个注册键中只有平台/MCP 凭据族（4 键）真必填，且仅当用户要用平台功能。测试面按变更动态推断、lint 未配置自动跳过归 pre-push、FR 回归层缺省不跑归 CI——都是零配置最优缺省（2026-10-23 起）。

**不要「预防性配置」**：不确定要不要写的键就是不写。写了多余键的唯一效果是偏离缺省、增加审计面。

## 必填场景决策表（只有这些场景才动配置）

| 场景 | 症状/触发 | 要写的键 | 怎么获得值 |
|---|---|---|---|
| 平台同步/看板 | 用户要用 SillyHub 平台 | `platform.url` + `platform.token` | **不手填**：跑 `sillyspec platform connect <url> --token <t>` 自动写 |
| MCP 派发 | 评审平台单调用/独立审查派发 | `mcp.url` + `mcp.token` | 同上（connect 成对签发） |
| 评审单调用 | 用户要评审收口一次完成（省 missing→PASS 往返） | `review_inline_wait: 180` | 依赖 mcp 凭据；平台不可用自动回退任务书面零损失 |
| dirty 门残渣 | 收口反复被已知残渣文件拦（--accept-dirty-gap 成常态） | `dirty_gate_ignore: <前缀1>, <前缀2>` | 看收口输出点名的文件，取其稳定目录前缀 |
| lint 收口实测 | 用户要 lint 在收口时跑（缺省跳过归 pre-push） | `commands.lint: <命令>` | 从 package.json scripts / Makefile 抄 |
| 慢套件超时 | 实测被 600s 默认帽判超时失败 | `commands.test_timeout_sec: 2400` | 收口输出会提示 |
| 全量测试道 | 用户明确要本地跑全量（罕见） | `test_strategy: full` | 仅显式全量时；缺省动态子集已是最优 |
| 项目特有评审必查面 | 团队有自己的评审红线 | `review_probes:` 段 | 见 `sillyspec config schema` review_probes 节 |

调优键全清单与语义：`sillyspec config schema`（单一真相；example 列可照抄值）。

## 操作流程

1. **看现状**：`sillyspec config cat`（权威路径链解析——worktree 内也能拿到主仓真实文件；不存在=零配置形态，正常）。
2. **对决策表**：确认触发场景真实存在；不在表内的场景**不写任何键**，向用户说明缺省行为已覆盖。
3. **获得值**：凭据族走 `sillyspec platform connect`（禁止手填 token 到 yaml）；其余键从仓库结构（package.json/pyproject/Makefile）或收口输出提示取值。
4. **写文件**：编辑 `.sillyspec/local.yaml`（config cat 显示的路径；整文件 YAML，注意缩进用空格、保存为 UTF-8 无 BOM——PS 下用 Set-Content -Encoding utf8NoBOM 或让 CLI 命令代写）。**只写决策表需要的键，逐键照抄 schema 的 example 形态。**
5. **硬门验证（必做，不许跳过）**：跑 `sillyspec config validate`
   - **exit 0 才算配置完成**；exit 1 时按输出的错误行逐条修复后重跑。
   - 有「未知顶层键」警告=键名/层级写错，回 schema 核对。
   - 凭据段报缺键=两键要成对（或整段删除回退）。
   - **禁止**在 validate 未通过时向用户宣称配置完成。

## 边界

- 禁止写 `.sillyspec/` 之外的 local.yaml（hook 拦截）；项目根没有这个文件。
- 禁止把 token 写进 local.yaml.example 或任何可提交文件（真实 local.yaml 是 gitignored）。
- known_failures 豁免键不用手改 yaml：`sillyspec config known-failures add|remove`（行级手术保注释）。
