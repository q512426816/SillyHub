---
author: qinyi
created_at: 2026-09-11 18:41:00
---
# 提案书（Proposal）

## 动机

会话级供应商切换目前 claude-only：codex/pi 会话里用户点「切换供应商」被前端拦截（「当前引擎不支持会话级供应商切换」），即使放行 daemon reload 链路也不生效（reload 不写 codex/pi 的 per-session 配置目录、不保留 CODEX_HOME/PI_CODING_AGENT_DIR env）。上一变更 2026-09-10-multi-provider-injection 只补齐了 spawn 时的凭证注入（新会话必生效），会话中途切换显式不在其范围。本变更补齐 daemon reload 链路 + 前端解锁，使 codex/pi 与 claude 完全对齐（含切回本机默认）。

## 关键问题

1. **daemon reload 断层**：`_reloadSessionNow` 只走 env 层 buildSpawnEnv——codex 二进制不读凭证 env（spike A1，env 注入器刻意不注册 codex），pi 自定义端点走文件层；reload 不调 applyProviderFileSettings、不保留文件层 env → 切了不生效。
2. **前端双重门禁**：session-panel-page.tsx:2358（错误卡按钮）与 session-config-bar.tsx:270（配置条下拉锁）均写死 `!== "claude"`。
3. **切回本机默认的历史/凭证语义**：codex thread 历史在 CODEX_HOME 下（丢目录=断 resume）；pi 回宿主 `~/.pi` 可能无凭证——需要镜像/回退设计而非简单删门禁。
4. **既有缺口顺手收编**：restore 路径（daemon 重启恢复）对 codex/pi 不注文件层 env，切换后重启即静默回宿主凭证；codex 从宿主起步首切供应商时 thread 历史需迁移，否则新 CODEX_HOME 下 resume 必断。

## 变更范围

- daemon：applyProviderFileSettings 平移共享模块 + 新增 reload 变体（失败兜底内聚返回值）+ codex 宿主凭证镜像/线程迁移两 helper + _reloadSessionNow 文件层合并 + restore 自愈 + reloadWithProvider 删 claude-only 守卫 + cli.ts 注入 daemonApiKey
- frontend：PROVIDER_SWITCH_ENGINES 白名单常量 + 两处门禁白名单化 + 供应商下拉按引擎过滤 + 锁定文案引擎中性化
- 测试：daemon 4 个测试文件 + frontend 1 个测试套件（详见 design 文件变更清单）

## 不在范围内（显式清单）

- 不做 cursor 解锁（spike 已证无注入面，归档 D-007）；gemini 未注册不涉及
- 不改 backend（inject/SESSION_SWITCH_CONFIG/422 校验均已就位；预期零 backend 改动）
- 不改 ProviderCaps 9 键矩阵（前端用本地白名单常量）
- 不做 pi 宿主凭证镜像、codex 反向历史迁移（语义上不需要，见 design 非目标）
- 不动 daemon.ts:7713 既有热切换尽力重写（保留为幂等预写）

## 成功标准（可验证）

- codex/pi 会话内切换供应商：turn 边界 reload 后新子进程携带新供应商配置（单测锁定 env 合并 + 写盘产物）；对话历史保留（codex 同目录重写 / pi 历史与配置目录无关）
- codex/pi 切回「不指定（本机默认）」：codex 宿主凭证镜像进 per-session 目录且 CODEX_HOME 不丢（resume 不断）；pi 丢 PI_CODING_AGENT_DIR 回宿主
- 切换后 daemon 重启恢复：codex/pi 会话恢复仍带文件层 env（restore 自愈）；codex null 切换后恢复不丢 thread（目录探测修法）
- 供应商下拉按引擎过滤；cursor/未知引擎仍锁定（文案引擎中性）
- claude 全链路行为零漂移（既有测试全绿）
