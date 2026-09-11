---
plan_level: full
---

# 实现计划（Plan）

## Spike 前置验证
无需 Spike——codex/pi 注入面结论沿用归档变更 2026-09-10-multi-provider-injection 的三路实机 spike（A1 codex 无 env 面 / A2 CODEX_HOME 文件层 / B1 pi 文件层压制），本变更是其在 reload/restore 路径的接线延伸；rollout 首行字段以仓内 fixture 为锚（execute 兼容读法已在 design 接口定义写明）。

## Wave 1（纯移动，零行为变化）
- task-01

## Wave 2（依赖 Wave 1）
- task-02

## Wave 3（依赖 Wave 2；两 task 文件集不相交可并行）
- task-03
- task-05

## Wave 4（依赖 Wave 3——types 字段/前端常量就位）
- task-04

## Wave 5（依赖 Wave 1-4 全链路产物；两 task 分属 daemon/frontend 可并行）
- task-06
- task-07

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 共享模块抽取——applyProviderFileSettings 及伴生符号平移 provider-file-settings.ts + 两接线点/两测试改 import | W1 | P0 | — | FR-01 前置 | 纯移动逐字不变，spawn 路径零漂移 |
| task-02 | ForReload 变体 + codex 宿主凭证镜像/thread 迁移两 helper | W2 | P0 | task-01 | FR-01, FR-02, FR-05, D-001@v1 | 失败兜底语义内聚返回值（design 接口定义矩阵） |
| task-03 | reload 内核接入——_reloadSessionNow codex/pi 文件层合并 + codex 迁移钩子 + reloadWithProvider 删守卫 + types/cli daemonApiKey 注入 | W3 | P0 | task-02 | FR-01, FR-04, D-003@v1 | 热切换（PROVIDER_CONFIG_CHANGED）随之确定性化 |
| task-04 | restore 自愈——persistence 恢复路径 codex/pi 注文件层 env + codex null 目录探测修法 | W4 | P0 | task-02, task-03 | FR-01, FR-02 | Grill 附带发现收编；依赖 types.daemonApiKey 字段 |
| task-05 | 前端解锁——PROVIDER_SWITCH_ENGINES + 两处门禁白名单化 + 下拉按引擎过滤 + 锁定文案中性化 | W3 | P0 | — | FR-03, D-002@v1 | 独立于 daemon 侧，可并行 |
| task-06 | daemon 测试收口——ForReload 分派矩阵 / mirror / 迁移 / reload / restore / 热切换语义更新 | W5 | P0 | task-01~04 | FR-01~05 | 含既有三测试文件 import/语义迁移 |
| task-07 | frontend 测试收口——门禁矩阵 + kind 过滤 + provider 空前置 | W5 | P0 | task-05 | FR-03 | 既有套件扩展 |

## 关键路径
task-01 → task-02 → task-03 → task-04 → task-06（daemon 主链；frontend 链 task-05 → task-07 与之并行）

## 全局验收标准
1. daemon 修改相关测试全绿（provider-file-settings / codex-settings / reload / restore / 热切换 handler / smoke integ）；不跑全量（CLAUDE.md 规则 0）
2. frontend 修改相关测试全绿（session-panel-provider-caps / config-bar 套件）+ pnpm typecheck
3. daemon pnpm typecheck 全绿（含 cli.ts/types.ts 新字段）
4. claude 全链路零漂移：既有 claude reload/restore/provider-switch 相关测试不改预期全绿
5. 未切换的 codex/pi 会话行为不变：未带 provider_config 的 reload 不写盘不注 env（测试锁定）
6. 集成敏感（risk_level=deployment-critical 提示）：verify 阶段按门控补真实集成证据（daemon 侧 env 合并/写盘产物至少以 integ 冒烟形态锚定）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-03, task-04 | ForReload null 分派矩阵测试 + codex 镜像/目录探测测试 |
| D-002@v1 | task-05, task-07 | config-bar kind 过滤与门禁矩阵测试 |
| D-003@v1 | task-03, task-06 | reload 内核接线测试 + 热切换 handler 语义更新测试 |
| FR-01 | task-02~04, task-06 | reload/restore env 合并测试 |
| FR-02 | task-02, task-04, task-06 | codex 镜像 + null 目录探测测试 |
| FR-03 | task-05, task-07 | 前端门禁/过滤测试 |
| FR-04 | task-03, task-06 | reloadWithProvider codex 走通测试 |
| FR-05 | task-02, task-06 | 迁移钩子触发条件测试 |
