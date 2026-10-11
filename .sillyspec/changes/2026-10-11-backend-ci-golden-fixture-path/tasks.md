---
author: flow-machine-draft
created_at: 2026-10-11T15:25:27.215Z
---
# 任务注册表（Tasks）— 2026-10-11-backend-ci-golden-fixture-path

- [x] task-01: backend-ci.yml push 与 pull_request 两处 paths 各加 sillyhub-daemon/tests/fixtures/**，workflow 文件自身路径保留
- [x] task-02: YAML 语法可解析（python yaml.safe_load 过）
- [x] task-03: 不跑全量测试（规则 0），workflow 生效由推送后 backend-ci 实跑验证
