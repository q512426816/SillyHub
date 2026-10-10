
## SILLYSPEC_TEST_TIMEOUT_MS 单位二义（verify-postcheck.js 同文件两读法）

`src/verify-postcheck.js` 内 `TEST_TIMEOUT_MS = Number(env.SILLYSPEC_TEST_TIMEOUT_MS) || 600_000`（**毫秒**语义，批执行器消费）与 `resolveTestTimeoutMs()`（**秒**×1000 语义，config-schema.js 文档口径「env 同效 test_timeout_sec」）对同一环境变量单位不一致：按文档传秒值（如 1800）会被批执行器当 1.8s 帽，deps(auto-py) 批 spawnSync 瞬时 ETIMEDOUT（2026-10-10 实证：总时长 4161ms 两批全灭）。规避：传毫秒（1800000）。根修：统一二处单位或换变量名。（2026-10-10-borrow-sandbox-workspace-context verify 期踩坑）
