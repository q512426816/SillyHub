---
id: task-01
title: 'daemon 诊断 RPC（测试先行同卡）——diag-rpc.ts 尾部读+脱敏 + daemon.ts 注册 handler + vitest 单测'
title_zh: 'daemon 诊断 RPC（测试先行同卡）——diag-rpc.ts 尾部读+脱敏 + daemon.ts 注册 handler + vitest 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 17:07:07
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-03, FR-04, FR-07]
decision_ids: [D-001@v2, D-002@v1, D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/diag-rpc.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/diag-rpc.test.ts
target_files:
  - NEW:sillyhub-daemon/src/diag-rpc.ts
  - sillyhub-daemon/src/daemon.ts
  - NEW:sillyhub-daemon/tests/diag-rpc.test.ts
goal: >
  实现 daemon 侧两个只读诊断 RPC（daemon_log_tail / daemon_config_get），供 backend 转发端点调用：
  日志尾部按字节+行双上限读取（不全量加载），配置按 D-001@v2 掩码公式返回（reveal 按需明文）。
  测试先行同卡（vitest 先红后绿）。
implementation:
  - 先写 sillyhub-daemon/tests/diag-rpc.test.ts（红）：readLogTail 尾部行正确性/大文件分块/262144B 字节上限 truncated/UTF-8 块边界（中文）/文件不存在 exists:false 五字段兜底（size:0/mtime:""/lines:[]/line_count:0/truncated:false）/tail_lines clamp 1..5000；getMaskedConfig 掩码边界 len=0/8/9/15/16/24/reveal/字段清单/值缺失原样
  - 新建 sillyhub-daemon/src/diag-rpc.ts：readLogTail（fs/promises open+stat，64KB 块从末尾向前扫换行符，行上限 tailLines 与字节上限 262144B 先到先截，块边界修剪残缺 UTF-8 字节序列）+ getMaskedConfig（SENSITIVE_CONFIG_FIELDS=['token','api_key'] 常量；len<16 → '***'；len≥16 → 前4位+'***'+后4位）
  - sillyhub-daemon/src/daemon.ts 就近 _registerHostFsRpcHandler（:6985 区域）新增 _registerDiagRpcHandler(ws)：daemon_log_tail（参数 tail_lines clamp 1..5000 默认 500，路径 join(DEFAULT_CONFIG_DIR,'daemon.log')——常量取 sillyhub-daemon/src/config.ts:147，不 import cli.ts）+ daemon_config_get（读 this._config 生效配置，路径 configPathForServer(this._config.server_url)——sillyhub-daemon/src/config.ts:207，reveal 默认 false）
  - 跑 daemon 测试与 typecheck 全绿；确认新 handler 经 _dispatchRpc 注册路径可调用（单测直接以 handler 工厂验证）
acceptance:
  - diag-rpc.test.ts 全绿（尾部行/字节上限 truncated/UTF-8 中文块边界/不存在兜底/掩码六档边界/clamp 全覆盖）
  - sillyhub-daemon 全量 vitest 通过 + pnpm typecheck 零错误
  - handler 注册与既有 _registerHostFsRpcHandler 同模式（ws.registerRpcHandler 调用），无 CLI/日志写入行为改动
verify:
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 零第三方运行时依赖（仅 node:fs/promises、node:path 等内置模块）
  - 不 import cli.ts（其顶层 void main() 无入口守卫，import 会触发 CLI main）；不改 cli.ts、不改 attachConsoleToLogFile 日志写入路径
  - 正常路径不抛 RpcError（exists:false/掩码均结构化返回）；SENSITIVE_CONFIG_FIELDS 常量处注释「新增凭据字段时须同步维护」
---
