---
author: flow-machine-draft
created_at: 2026-10-11T15:25:27.215Z
---
# 提案书（Proposal）— 2026-10-11-backend-ci-golden-fixture-path

## 动机

任务原话转写：动机：backend parity 测试（app/modules/daemon/tests/test_run_sync_golden_parity.py）直接消费 sillyhub-daemon/tests/fixtures/claude-sdk-messages/golden-session*.json 三件套（docstring 自载跨端共享），但 backend-ci.yml 的 paths 过滤只含 backend/**——daemon 侧 fixture 变更不会触发 backend-ci，parity 回归只能靠人肉本地跑兜底（2026-10-11-daemon-masked-test-fix 独立评审 P3 指出的 CI 盲区）。

成功标准：
- backend-ci.yml push 与 pull_request 两处 paths 各加 sillyhub-daemon/tests/fixtures/**，workflow 文件自身路径保留
- YAML 语法可解析（python yaml.safe_load 过）
- 不跑全量测试（规则 0），workflow 生效由推送后 backend-ci 实跑验证

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. backend-ci.yml push 与 pull_request 两处 paths 各加 sillyhub-daemon/tests/fixtures/**，workflow 文件自身路径保留
2. YAML 语法可解析（python yaml.safe_load 过）
3. 不跑全量测试（规则 0），workflow 生效由推送后 backend-ci 实跑验证

## 成功标准（可验证）

1. backend-ci.yml push 与 pull_request 两处 paths 各加 sillyhub-daemon/tests/fixtures/**，workflow 文件自身路径保留
2. YAML 语法可解析（python yaml.safe_load 过）
3. 不跑全量测试（规则 0），workflow 生效由推送后 backend-ci 实跑验证
