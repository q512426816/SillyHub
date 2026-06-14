---
schema_version: 1
doc_type: module-card
module_id: agent-detector
author: qinyi
created_at: 2026-06-10T16:55:00
---

# agent-detector

## 定位
检测本机已安装的 coding agent CLI 工具。支持 12 种 agent provider，通过环境变量覆盖 + PATH 查找 + 版本探测 + 最低版本检查完成全面检测。为 daemon 注册阶段提供可用 agent 列表。

## 契约摘要
- `AgentProtocol` — 协议字面量联合类型（stream_json / json_rpc / jsonl / ndjson / text）
- `ProviderName` — provider 名字面量联合类型
- `AgentProviderSpec` — provider 定义：bin 名、环境变量名、版本正则、协议、最低版本
- `PROVIDER_SPECS` — 12 种 provider 的定义对象（键为 ProviderName）
- `DetectedAgent` — 检测结果：名称、路径、版本、协议、是否可用、版本警告
- `AgentDetector` — 检测器类
  - `detectAll(): Promise<DetectedAgent[]>` — 检测全部 agent
  - `detectOne(name): Promise<DetectedAgent | null>` — 检测单个 agent
  - `isAvailable(name): boolean` — 同步快速检查可用性

## 关键逻辑
```
detectAll()
  for each [name, spec] of Object.entries(PROVIDER_SPECS):
    detectSingle(name, spec)
      binPath = resolveBinPath(spec)
        → process.env[envPath] && fs.existsSync → path
        → which(spec.bin) → path
        → null (unavailable)
      version = detectVersion(binPath, spec)
        → run `<binPath> --version`, apply versionPattern regex
      versionWarning = checkMinVersion(name, version)
      return new DetectedAgent(...)
```

## 注意事项
- 12 种 provider 的定义集中在 `PROVIDER_SPECS` 对象，新增 agent 需在此添加条目
- 环境变量命名规则：`SILLYHUB_<NAME>_PATH`，如 `SILLYHUB_CLAUDE_PATH`
- 版本检测通过 `child_process.execFile`，有超时保护
- `versionPattern` 是正则表达式，需与对应 CLI 的 `--version` 输出格式匹配
- Node 版去掉了废弃的 `AgentInfo` 与 `getCapabilities`
- 依赖 version 模块做版本比较

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
