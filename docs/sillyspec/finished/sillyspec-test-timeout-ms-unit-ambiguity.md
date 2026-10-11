# SILLYSPEC_TEST_TIMEOUT_MS 单位二义（verify-postcheck.js 同文件两读法）——已修

> 自 active-pitfalls.md 索引移入（处置后归档惯例）。

## 处置记录（2026-10-11）

**已修**（sillyspec 仓工作树，未提交）：`verify-postcheck.js` 新增 `parseTestTimeoutEnvMs`
单源解析——**秒为契约单位**（与 config-schema `test_timeout_sec` 文档口径一致），两读法
（批执行器常量 `TEST_TIMEOUT_MS` 与 `resolveTestTimeoutMs`）统一走它；≥10000 的值按毫秒
兼容解释（实证期规避口径）并打告警促改秒。三态验证：`1800`→1800s ✓、`1800000`→
30min+告警 ✓、缺省 600s ✓；`test-timeout-config.test.mjs` 3/3 绿。
