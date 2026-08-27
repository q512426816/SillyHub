# verify 探针 5（API Contract Parity）对账基线失配——全量误报 missing

- 日期：2026-08-23
- 状态：**活跃坑**（工具未修；语义复核可绕过，不阻断 verify——CLI 仅 advisory）
- 发现来源：变更 `2026-08-23-platform-agent-log-ingest` verify 阶段跑 `sillyspec verify-probes --init`

## 现象

探针 5 报 **143 个前端调用无后端端点匹配**，但清单里几乎全是主仓存在多年的端点：
`GET /api/workspaces`、`POST /api/auth/login`、`GET /api/health`、全部 `/api/ppm/*`、
`/api/admin/*`、`/api/daemon/*`……连带本变更新增的 `GET /api/agent-logs` 也被列入。
同时报 784 个后端端点前端未调用。实际上后端 openapi.json 有 395 paths，前后端契约
正常（gen:types 幂等、全部页面正常工作）。

## 影响

- verify 报告噪声巨大（143 行假 missing），语义复核成本高；
- 新变更若不逐条甄别，容易误判「真实集成缺陷 → 回 execute 补端点」反向浪费。

## 推测根因（未深入定位）

探针 5 复用 `contract-matrix.verifyApiParity`（endpoints.json × 前端调用 diff）。
endpoints.json 来自 execute 的契约 artifact 提取（`.sillyspec/.runtime/contract-artifacts/`），
疑似基线陈旧或路径归一化失配（如 `/api` 前缀、`{param}` 占位形态、query 串处理），
导致匹配率趋近于零而非精准对账。

## 建议改进（工具侧）

1. 探针 5 先做**自检**：若 missing 率异常（如 >50% 前端调用 missing），直接标注
   「基线疑似失配，结果不可信」而不是输出 143 行表格；
2. endpoints.json 基线改为 verify 时**现算**（从 backend/openapi.json 提取），不用
   execute 期快照——openapi.json 是唯一真相且 verify 时一定是最新的；
3. 路径归一化对齐 openapi-typescript 消费侧形态（`{param}` / query / 前缀）。

## 绕过方式（当前）

按 verify 步骤 4 指引做语义复核：以 `backend/openapi.json` 为权威人工核验本变更
相关端点（本例：openapi 6 处命中 + gen:types 幂等 + e2e 200 三重证据），在
verify-result.md 探针 5 节明确标注「工具误报 + 权威核验结论」。
