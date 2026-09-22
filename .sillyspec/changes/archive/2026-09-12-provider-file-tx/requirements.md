---
author: qinyi
created_at: 2026-09-12 03:10:26
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| daemon reload 内核 | `_reloadSessionNow` 供应商切换执行者（本次改造主体） |
| per-session 文件层 | `daemonStateDir()/<codex|pi>/<sessionId>/` 凭证配置目录 |
| restore 恢复路径 | daemon 重启后 `persistence.ts` 会话恢复（消费生效标记） |

## 功能需求

### FR-01: reload 守卫前移（D-001@v1）
Given codex/pi 会话收到供应商切换请求
When resume key（agentSessionId）缺失
Then 在任何文件层写盘之前抛出（message 与现状逐字一致），per-session 目录零写入（无目标文件变更、无 tmp 残留）

### FR-02: reload 失败文件层回滚（D-002@v2）
Given reload 已执行文件层写盘（局部标记为真）
When 后续步骤（driver.start 等）失败进入 catch
Then 内存态还原后 best-effort 以 oldProviderConfig+oldEnv 重跑 ForReload 恢复文件层；若 ForReload 返回空对象且目录存在则 best-effort 删除 `.sillyhub-managed` 标记；回滚失败仅 error 日志，旧句柄降级与 rethrow 语义不变

### FR-03: 原子写（D-003@v1）
Given codex 两文件 / pi 三文件 / 宿主镜像拷贝任一写盘点
When 写入过程任一步失败（写 tmp/fsync/rename）
Then 目标文件保持旧全文；`.tmp-*` 被 best-effort 清理；成功时观察者只见旧或新全文（rollout 拷贝按 design 划界不纳入）

### FR-04: 生效标记与 restore 三态探测（D-004@v2）
Given per-session codex 目录
When 写盘成功（分支一，标记后置 best-effort）或 codex-null 镜像（分支四，标记先行——标记失败则跳过整个镜像含删除动作，返回 prior CODEX_HOME）
Then 目录含 `.sillyhub-managed` ⟺ 切换曾真实生效（删除类动作必晚于标记持久化）；restore null+codex 探测三态：标记在 → managed；无标记但 auth.json/config.toml 存在 → legacy managed（info 日志）；皆无 → 零动作（宿主语义，迁移钩子建目录恒落此态）

### FR-05: provider 维度引擎门（D-005@v2）
Given reload 调用携带 provider 切换载荷
When 引擎 ∉ {claude, codex, pi}（如 cursor）
Then 显式 throw 拒绝（fail-loud + 日志）；config-only 路径（人格/配置切换）不受门限制，全引擎行为不变

## 非功能需求
- 兼容性：存量已切换会话（无标记有 auth/config）restore 行为与现状一致（legacy 态）；未切换会话零变化；ForReload 矩阵/R-01 降级/宿主只读语义全部保持
- 三平台：rename 顶替在 Windows（MoveFileEx REPLACE_EXISTING）实测用例锁定；POSIX 原生原子
- 性能：每切换仅 5-6 小文件 fsync，无可感知开销

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 守卫前移 |
| D-002@v2 | FR-02 | catch 回滚 + 终态删标记（supersedes D-002@v1） |
| D-003@v1 | FR-03 | 原子写 + rollout 划界 |
| D-004@v2 | FR-04 | 标记先行序 + 三态探测（supersedes D-004@v1） |
| D-005@v2 | FR-05 | 门作用域限 provider 维度（supersedes D-005@v1） |
