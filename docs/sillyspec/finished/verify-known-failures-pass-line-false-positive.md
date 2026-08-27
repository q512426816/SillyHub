# verify 测试对账：通过行被误判为失败行（known_failures 假阳性淹没）

- **发现日期**：2026-08-28（变更 2026-08-27-session-token-usage-fix verify 阶段实证）
- **状态**：已解决（2026-08-28，sillyspec 仓 f2a3965 + c2870f2；本机 workaround 待 npm 发版升级后收缩）

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

## 修复记录（2026-08-28，sillyspec 仓 f2a3965 + c2870f2）

- **f2a3965**：partitionFailures 分类前剔除通过行（行首 ✓/√/✔/PASS 标记，剥 ANSI 色码后判定，返回保留原文）；PER_TEST_FAIL_RE 补 vitest ×(U+00D7) 失败标记；SUMMARY_LINE_RE 补 vitest 无冒号汇总行。
- **c2870f2**（真实全量输出实测后追加）：vitest 控制台捕获噪声另三类剔除——stdout/stderr|捕获横幅行、jsdom「Not implemented:」环境警告行、Failed Tests 分节头与 ELIFECYCLE 退出横幅归汇总行。
- **端到端实证**（本仓 frontend 全量 2710 用例 / 4 真实失败的真实输出）：失败行 382 → 15；7 条语义化豁免（3 文件名 + 2 套件名 + 2 错误类型）remaining=0 → judge 转 passed。
- **遗留运维步骤**：修复在 sillyspec 仓本地 commit，尚未 npm 发版——本机全局 CLI 3.27.9 未包含。发版升级后：①删除 local.yaml known_failures 的 A 段 workaround 条目（✓/stderr/Test Files/Tests/ELIFECYCLE/not implemented），②按 local.yaml 注释里的「收缩后清单」（7 条）替换，③B 段预存债按原计划归属变更收尾时修复移除。
