---
author: qinyi
created_at: 2026-09-11 18:41:00
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话面板中途切换本会话供应商（含切回本机默认）的最终用户 |
| daemon | sillyhub-daemon，会话 reload/restore/写盘执行方 |
| frontend | 会话面板 UI（配置条 + 错误卡门禁 + 下拉过滤） |

## 功能需求

### FR-01: codex/pi 会话内供应商切换确定性生效
覆盖决策：D-003@v1
Given codex 或 pi 引擎的 active 会话（已绑定平台供应商 A 或宿主起步均可）
When 用户在配置条选供应商 B（codex/pi kind 与引擎匹配）并确认
Then backend SESSION_SWITCH_CONFIG → daemon turn 边界 reload：重写 per-session 配置目录（CODEX_HOME 两文件 / PI_CODING_AGENT_DIR 三文件）、新子进程 env 携带文件层键、对话历史保留（codex 同 sessionKey 目录重写不删 sessions/；pi 历史在 daemon 自管 --session-dir）
And 切换后 daemon 重启恢复（restore）仍带文件层 env（providerConfig 非 null 即重写+注 env，不静默回宿主凭证）
And 写盘/IO 失败时行为等同未切（ForReload 返回 priorEnv 对应文件层键；restore 无 priorEnv 则返 {} 显式降级，error 日志可归因）

### FR-02: codex/pi 切回「不指定（本机默认）」不丢历史
覆盖决策：D-001@v1
Given codex 会话当前在平台供应商上（env 带 CODEX_HOME）
When 用户选「不指定（本机默认）」
Then reload 后 CODEX_HOME 保持原 per-session 目录（thread 历史不丢），宿主 ~/.codex 的 auth.json/config.toml 镜像进该目录（宿主无文件则删目录内两文件=如实反映未登录；镜像失败=目录留旧供应商产物，行为等同未切）
And codex null 切换后 daemon 重启恢复：探测确定性 per-session 目录存在 → 重镜像+注 CODEX_HOME（resume 不断）；目录不存在 → 行为与现状逐字一致
Given pi 会话当前在平台供应商上（env 带 PI_CODING_AGENT_DIR）
When 用户选「不指定（本机默认）」
Then reload 后新 env 不含 PI_CODING_AGENT_DIR（pi 回宿主 ~/.pi 凭证），会话历史不受影响

### FR-03: 供应商下拉按引擎过滤 + 门禁白名单化
覆盖决策：D-002@v1
Given 会话引擎为 E（claude/codex/pi）
When 打开配置条供应商下拉
Then 候选=「不指定（本机默认）」+ agent_kind === E 的供应商（全引擎保留默认项；选错 kind 撞 422 的现状坑随之消除）
And 引擎为 null 的 provisional 悬浮助手形态维持全量候选
Given 会话引擎为 cursor 或未知引擎
Then 配置条供应商控件锁定（title 引擎中性「当前引擎不支持会话级供应商切换」）；错误卡「切换供应商」按钮弹同文案提示
Given 会话 provider 为空/未知（session.provider 缺省）
Then 错误卡按钮不拦截（保留现状 null 放行语义）
Given claude/codex/pi 会话
Then 两处门禁（配置条锁 + 错误卡按钮）均放行

### FR-04: 默认供应商热切换（PROVIDER_CONFIG_CHANGED）对 codex/pi 确定性生效
覆盖决策：D-003@v1
Given codex/pi 引擎 active 会话
When 用户在 /settings 改默认供应商（backend 推 PROVIDER_CONFIG_CHANGED）
Then daemon markPendingSwitch → reloadWithProvider 不再因非 claude 抛错 → 与 FR-01 同一 reload 内核生效（空闲立即 / running 等 turn 边界）；daemon.ts 既有热切换尽力重写保留为幂等预写

### FR-05: codex 宿主起步会话首切供应商时迁移 thread 历史
Given codex 会话以宿主凭证起步（env 无 CODEX_HOME）且已有 thread（agentSessionId 非空）
When 用户首次切到平台供应商
Then reload 前把宿主 ~/.codex/sessions 下该 thread 的 rollout 文件按相对路径拷入 per-session 目录（首行会话 id 匹配，payload.session_id 为准兼容 session_meta.id）；迁移失败 warn 降级不阻断 reload（resume 失败由 codex 真实报错收敛）

## 非功能需求
- 兼容性：claude 全链路零漂移；spawn 路径（applyProviderFileSettings spawn 版）签名语义不变；backend/WS 消息形状/表结构零改动；未切换的 codex/pi 会话行为逐字不变
- 可回退：整体 revert 回 claude-only 现状；无不可逆数据变更（镜像/迁移只写平台自有目录+拷贝宿主文件，不删宿主内容）
- 可测试：ForReload 全分派矩阵（成功/IO 失败/门槛缺/null×镜像成败/priorEnv undefined 角落）、reload/restore 接线、前端门禁与过滤矩阵均有单测锚定

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | 本机默认开放 + codex 镜像保历史 / pi 回宿主 |
| D-002@v1 | FR-03 | 下拉按引擎过滤 |
| D-003@v1 | FR-01, FR-04 | reload 内核统一接入（方案 A） |
