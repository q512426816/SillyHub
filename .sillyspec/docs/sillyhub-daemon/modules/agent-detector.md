---
schema_version: 1
doc_type: module-card
module_id: agent-detector
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# agent-detector

## 定位
本机 12 种 coding agent CLI 探测器（Python `agent_detector.py` 1:1 迁移）。启动时按优先级 `env 覆盖 → PATH which → 不可用` 解析每个 provider 二进制路径，执行 `<bin> --version`（10s 超时）取版本，调 version.checkMinVersion 校验最低版本。为 daemon 注册阶段提供可用 agent 列表（FR-07）。零依赖（G-05，不引 which 库）。

## 契约摘要
- `AgentProtocol`：5 协议字面量联合（stream_json / json_rpc / jsonl / ndjson / text）。
- `ProviderName`：12 provider 名字面量联合（PROVIDER_SPECS 的 key）。
- `AgentProviderSpec`：`{ bin, envPath?, protocol, versionArgs?, versionPattern? }` 等。
- `PROVIDER_SPECS`：12 provider 定义对象。键：claude / codex / copilot / opencode / openclaw / hermes / gemini / pi / cursor / kimi / kiro / antigravity。
- `DetectedAgent`：`{ provider, path, version?, protocol, status: 'available'|'unavailable', versionWarning? }`。
- `AgentDetector`：`detectAgents(): Promise<DetectedAgent[]>`、`detectOne(name)`、`isAvailable(name)`。

## 关键逻辑
```
detectAgents(): 串行 for each [name, spec] of PROVIDER_SPECS → detectSingle
detectSingle(name, spec):
  binPath = resolveBinPath(spec)
    → env[spec.envPath] && existsSync ? env路径     // 优先级 1：env 覆盖
    → which(spec.bin) ? path                        // 优先级 2：PATH 查找（不引 which 库）
    → null (unavailable)
  version = detectVersion(binPath)
    → exec/execFile `<bin> --version`, timeout 10s, windowsHide
  versionWarning = checkMinVersion(name, version)
  return { provider:name, path, version, protocol:spec.protocol,
           status: binPath ? 'available' : 'unavailable', versionWarning }
```

## 注意事项
- 12 provider 定义集中在 PROVIDER_SPECS，新增 agent 需在此加条目（并同步 adapters 的 PROTOCOL_PROVIDERS）。
- env 指向不存在路径时降级到 PATH 查找（对齐 Python fallback to which）。
- DetectedAgent 字段名：`provider`（非 name）、`path`（非 bin_path）、`status`（非 available bool）——daemon 用 `status==='available'` 过滤、用 `provider` 作 key。
- daemon 真实调用的方法名是 `detectAgents()`（非 detectAll）。
- cursor provider 的版本解析经 cursor-version 模块（package.json 读取）。
- 依赖 version、cursor-version。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
