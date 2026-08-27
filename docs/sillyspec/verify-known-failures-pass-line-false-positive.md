# verify 测试对账：通过行被误判为失败行（known_failures 假阳性淹没）

- **发现日期**：2026-08-28（变更 2026-08-27-session-token-usage-fix verify 阶段实证）
- **状态**：活跃坑（已用 local.yaml workaround 绕过，待工具修复后移除）

## 现象

`verify --done` 的测试对账（verify-postcheck.js `partitionFailures`）把大量**通过**的用例行判为失败行：本仓 frontend 全量套件 2710 用例仅 4 个真实失败，但 `PER_TEST_FAIL_RE` 命中 382 个"失败行"——其中 378 行是带 vitest 通过标记 `✓` 的用例行，仅因用例名含 `failed` / `error` / `exception` 字样（如 `同步 5min 上限：超时后 syncStatus=failed`、`服务端 failed 排队条目`）即被 `/FAILED/i` 子串命中。`SUMMARY_LINE_RE` 只排汇总行，不排 ✓ 通过行。

## 后果

`judgeWithKnownFailures` 要求全部失败行命中豁免清单才能转 passed——假阳性行数远超真实失败，known_failures 机制在 vitest 详细输出下**实质失效**（无法逐条枚举几百个随机用例名）。verify 阶段护栏又禁止改测试源码，形成"修不了测试、豁免不生效"的双卡。

## 当前 workaround（local.yaml）

`known_failures` 首条加 `"✓"` 模式：vitest 通过行恒含 ✓ 且真实失败行（×/FAIL）不含，恰好把假阳性集合与真实失败集合分离；真实失败再按文件名模式豁免。风险：若某失败输出行同时含 ✓（理论不出现于 vitest 标准输出）会被误豁免——工具修复后应删除该条。

## 建议修复方向（sillyspec 侧）

1. `PER_TEST_FAIL_RE` 的 `FAILED` 分支改为 `\bFAILED\b` 且要求行内不含通过标记（`✓`/`√`/`PASS`），或先按 `✓` 前缀剔除通过行再匹配；
2. 或 vitest 输出走结构化解析（`--reporter=json`）替代行扫描；
3. `SUMMARY_LINE_RE` 增补 vitest `✓`/`×` 前缀行分类。
