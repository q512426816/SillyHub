---
author: qinyi
created_at: 2026-08-23T20:23:44
---

# sillyspec 本地模式 init 的残留清理无条件删除 local.yaml——平台 init 下发的凭据被静默清掉

- 日期：2026-08-23
- 状态：**活跃坑**（sillyspec CLI 未修；平台侧 init 是平台模式不受影响，风险来自人工/agent 在被平台管理的工作区里跑本地模式 init）
- 发现来源：工作区 `de24ed7c`（SillyHub，repo-native）初始化后 `.sillyspec/local.yaml` 消失的排查（QUICKLOG ql-20260823-011-d9bf 关联现场）

## 现象（2026-08-23 实证）

15:37 平台初始化 lease 成功完成：token 已签发注入 claim payload、daemon 第 5 步 `writeLocalYaml` 写盘成功（写失败即 lease failed，而 lease 是 completed）。约一小时后 `.sillyspec/local.yaml` 不存在，且 shell 历史/会话记录均无痕迹。

## 根因

`/opt/homebrew/lib/node_modules/sillyspec/src/init.js` 的 `doInstall`：

1. `cleanupRuntimeResidue(legacyDir)` 把 `local.yaml` 与 `codebase/` 列为"非权威残留"**无条件 `rmSync`**（注释原文"整删安全"）；
2. 更糟的是**连"拒绝整删"保护分支也删**：非平台模式 + 外部 `--spec-dir` + 检测到真实资产（changes/、projects/、sillyspec.db）时，打出"拒绝删除源码目录的 .sillyspec/，保留权威状态"的提示后，仍调用 `cleanupRuntimeResidue` 把 local.yaml 删掉——保护语义名不副实；
3. 触发条件宽：任何人在（或 agent 在）被平台管理的工作区根目录跑 `sillyspec init --spec-dir <任意>`，本地模式即命中清理段。平台模式（`--workspace-id`/`--runtime-root`）已正确旁路（init.js "平台模式整体绕过清理段"），不受影响。

平台侧全链路（claim 注入明文 → daemon 写盘）与 sillyspec 本地清理逻辑**互相不知道对方**：平台把 local.yaml 当作用户本地凭据的权威落点（服务器永不存储、sync 只做段级改写），sillyspec 却把它当可重建缓存。

## 影响

- 平台初始化产出的凭据文件被静默清掉，CLI 推送 / MCP 反调静默失效，用户只看到"配置好像没生效"；
- 排查成本高：删除动作不留日志、无平台事件，只能靠排除法。

## 建议工具修复方向（sillyspec CLI 仓库）

- `cleanupRuntimeResidue` 移除对 `local.yaml` 的删除，或仅在其不含 `platform.token`/`mcp.token` 段（纯模板拷贝）时才清；
- "拒绝整删"分支至少应与整删分支的清理范围区分：资产保护场景下 local.yaml 必须保留；
- 清理发生时打印被删文件清单（当前静默 `try{}catch{}`）。

## 关联

- `docs/sillyspec/init-revokes-persistent-local-yaml-tokens.md`（同为 init × local.yaml 交互坑，一个是吊销、一个是删文件）
- 平台模块：workspace init lease（sillyhub-daemon spec-sync handleInitLease 第 5 步）
