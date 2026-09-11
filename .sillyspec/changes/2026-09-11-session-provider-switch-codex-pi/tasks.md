---
author: qinyi
created_at: 2026-09-11 18:41:00
---
# 任务清单（Tasks）

- [ ] task-01: 共享模块抽取——applyProviderFileSettings 及伴生符号从 task-runner.ts 平移 provider-file-settings.ts + 两接线点/两测试改 import（纯移动零行为）
- [ ] task-02: ForReload 变体（失败兜底内聚返回值矩阵）+ codex 宿主凭证镜像 mirrorCodexHostAuth / thread 迁移 migrateCodexThreadFromHost 两 helper (depends_on: task-01)
- [ ] task-03: reload 内核接入——_reloadSessionNow codex/pi 文件层合并 + codex 迁移钩子 + reloadWithProvider 删 claude-only 守卫 + types/cli daemonApiKey 注入 (depends_on: task-02)
- [ ] task-04: restore 自愈——persistence.ts 恢复路径 codex/pi 注文件层 env + codex null per-session 目录探测修法 (depends_on: task-02, task-03)
- [ ] task-05: 前端解锁——PROVIDER_SWITCH_ENGINES 白名单 + 配置条/错误卡门禁白名单化 + 下拉按引擎过滤 + 锁定文案引擎中性化
- [ ] task-06: daemon 测试收口——ForReload 分派矩阵 / mirror / 迁移 / reload / restore / 热切换语义更新（含既有测试 import 迁移 + session-manager-config-switch / session-manager-reload-provider 两文件 claude-only 断言改写）(depends_on: task-01, task-02, task-03, task-04)
- [ ] task-07: frontend 测试收口——门禁矩阵（claude/codex/pi 放行，cursor/未知锁定）+ kind 过滤 + provider 空前置（含 session-config-bar.test.tsx codex 锁定三用例改写）(depends_on: task-05)
