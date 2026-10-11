---
author: flow-machine-draft
created_at: 2026-10-11T15:25:27.215Z
---
# 需求规格（Requirements）— 2026-10-11-backend-ci-golden-fixture-path

## 功能需求

### FR-01: backend-ci.yml push 与 pull_request 两处 paths 各加 sillyhub-daemon/tests/fixtures/**，workflow 文件自身路径保留

- backend-ci.yml 的 push 与 pull_request 触发面必须在原有 `backend/**` 与 workflow 文件自身路径之外各增加 `sillyhub-daemon/tests/fixtures/**`（daemon golden 三件套被 backend parity 测试 `app/modules/daemon/tests/test_run_sync_golden_parity.py` 跨端消费，fixture 变更必须触发 backend-ci 验 parity），且不得删除任何既有路径。

#### 场景：主路径

- Given：parity 测试 docstring 自载消费 `sillyhub-daemon/tests/fixtures/claude-sdk-messages/golden-session*.json`。
- When：daemon 侧 golden fixture 变更被推送。
- Then：backend-ci 自动触发，parity 回归不再只靠本地人肉跑（2026-10-11-daemon-masked-test-fix 评审 P3 指出的 CI 盲区收口）。

### FR-02: YAML 语法可解析（python yaml.safe_load 过）

- 修改后的 workflow 文件必须通过 YAML 语法校验（python yaml.safe_load 不抛异常），push 与 pull_request 两处 paths 均含 3 项（backend/**、sillyhub-daemon/tests/fixtures/**、workflow 自身）。

#### 场景：主路径

- Given：backend-ci.yml 增补两处 paths 后。
- When：yaml.safe_load 解析。
- Then：解析成功且两处 paths 各含全部 3 项。

### FR-03: 不跑全量测试（规则 0），workflow 生效由推送后 backend-ci 实跑验证

- 本变更必须只做配置改动 + YAML 静态校验，禁止跑全量测试套件；workflow 触发面的真实验证必须由推送后 GitHub Actions 的 backend-ci 实跑完成。

#### 场景：主路径

- Given：CLAUDE.md 规则 0 与本变更为纯 CI 配置改动。
- When：验证方式选择。
- Then：仅静态校验本地执行，触发面生效由推送后 backend-ci 实跑确认。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：CI workflow 配置无单测面——生效验证 = FR-02 YAML 解析 + 推送后 backend-ci 实跑（本轮 paths 含 workflow 自身必触发）
FR-02: 不适用：YAML 语法校验为一次性静态门（python yaml.safe_load），无项目内测试面
FR-03: 不适用：流程约束条款（禁止跑全量），由验证方式本身佐证
