---
id: task-02
title: "daemon ws-client.ts 传 X-API-Key"
title_zh: "daemon WS 客户端补 X-API-Key header"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/ws-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/ws-client.test.ts
provides: {}
expects_from:
  - contract: ws_upgrade_auth_helper
    from: task-01
    expectation: backend WS 升级期校验 X-API-Key，daemon 必须同窗口带头否则断连
goal: >
  daemon 侧 WS 建连时携带 X-API-Key header，与 backend task-01 升级期鉴权配套，避免全部 daemon 断连。
implementation:
  - WsClientOpts 增加 apiKey 可选字段（types.ts 中如接口在 ws-client.ts 内定义则就地加，不越 allowed_paths）
  - ws-client.ts _createSocket 改为 new WebSocket(url, { headers })，apiKey 存在时 headers 带 X-API-Key，否则不传 headers 保持向后兼容
  - daemon.ts _ensureWsClient 工厂调用处（约 :2243）在构造 opts 时加 apiKey: this._config.api_key（config 已持有 hub apiKey）
  - 确认 ws npm 包版本支持 headers 选项，不支持则先升级依赖并记录
  - vitest 先写失败断言（_createSocket 收到 headers 含 X-API-Key），再改实现
acceptance:
  - apiKey 配置时 _createSocket 的 WebSocket 第二参 headers 含 X-API-Key 且值为 config.api_key
  - 无 apiKey 时仍以单参形式建连（mock 测试环境可连，向后兼容）
  - ws-client.test.ts 既有用例全部通过
verify:
  - cd sillyhub-daemon && npm test -- ws-client.test.ts
  - cd sillyhub-daemon && npm run typecheck（若项目脚本名不同以 package.json 为准）
constraints:
  - 与 task-01 同一提交窗口（backend 加鉴权后 daemon 不带头即全断，plan 明确要求）
  - 只动 daemon 客户端三文件，不改 backend
  - apiKey 不落日志（沿 spawn-env.ts 不泄漏铁律，ws-client 错误日志不打印 headers）
related_tests:
  - path: sillyhub-daemon/tests/ws-client.test.ts
    reason: 既有 _createSocket 相关断言假设无 headers 第二参，补 headers 后需回归确认构造调用形态变化不破坏 stub
---
