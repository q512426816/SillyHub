---
schema_version: 1
doc_type: module-card
module_id: agent-detector
author: qinyi
created_at: 2026-08-18 01:45:00
---

# agent CLI 探测器（agent-detector）

## 定位
本机 12 种 coding agent CLI 探测器（Python agent_detector.py 1:1 迁移，零第三方依赖）。daemon 启动时按优先级「env 覆盖 → PATH 查找 → 不可用」解析每个 provider 的二进制路径，执行 `<bin> --version`（10s 超时）取版本，调 version.checkMinVersion 校验最低版本，产出可用 agent 列表供 daemon 注册阶段上报 backend。

## 契约摘要
- `PROVIDER_SPECS`：12 provider 探测表（键序：claude/codex/copilot/opencode/openclaw/hermes/gemini/pi/cursor/kimi/kiro/antigravity），每项 `{ bin, envPath, versionPattern, protocol, minVersion? }`。bin 名如 `cursor-agent`、`kiro-cli`、`agy`（与 provider 名不总一致）；envPath 形如 `SILLYHUB_CLAUDE_PATH`。
- `AgentProtocol`：6 协议字面量联合（stream_json/json_rpc/jsonl/ndjson/pi_json/text），与 adapters 的 ProtocolType 对齐。
- `DetectedAgent`：{ provider, path, version?, protocol, status: 'available'|'unavailable', reason?, versionWarning, runtimeId? }。runtimeId 探测时恒 undefined，daemon 注册成功后由 backend 响应回填。
- `AgentDetector`：`detectAgents()`（串行 12 个，对齐 Python，非 Promise.all）、`detectOne(name)`（未知返回 null）、`isAvailable(name)`（仅 PATH 解析不执行 --version）。
- `normalizeProvider(raw)`：backend adapter id 归一化为 detector provider key（见注意事项）。

## 关键逻辑
```text
detectSingle(name, spec):
  binPath = resolveBinPath(spec)
    # 1) env[spec.envPath] 且 existsSync → 用 env 值；指向不存在路径 → 降级 PATH
    # 2) findOnPath(spec.bin)：遍历 PATH 目录 × 后缀；win32 后缀 [.exe,.cmd,.bat,.ps1]，非 win32 ['']
  binPath === null → { status:'unavailable', reason:'not-found' }
  version = detectVersion(binPath)      # execFile/exec '<bin> --version'，10s 超时，
                                        # stdout+stderr 合并扫描 versionPattern 捕获组 1
  version===null 且 name==='cursor' → resolveCursorVersionEntry(binPath) 目录名兜底
  versionWarning = version ? checkMinVersion(name, version) : null
  → { status:'available', ... }
```

## 注意事项
- **WINDOWS_EXTS 刻意不含空扩展名 ''**（ql-20260616-001）：含 '' 会命中 npm 生成的无扩展名 sh wrapper（git-bash 环境），Node spawn 不走 shell 时 CreateProcess 失败 ENOENT；宁可 provider 标 unavailable 也不静默崩。
- Windows 上 .cmd/.bat 包装的 binPath 走 shell exec 分支探测版本（对齐 Python create_subprocess_shell）。
- cursor 专属兜底（ql-20260620-002-f8c1）：官方 cursor-agent.ps1 版本目录正则不匹配新版目录命名 → `--version` 必 exit 1；改为解析 `versions/<latest>/` 目取名作版本号（cursor-version 模块）。cursor 无 minVersion。
- **normalizeProvider 的命名空间归一**：backend AgentRun.agent_type 是 adapter id（默认 'claude_code'），daemon _agentPaths 按 detector key 注册；不归一化则 `_agentPaths.get('claude_code')` undefined → interactive 静默早返回 → lease 永远 claimed（ql-20260703-001）。已知映射 claude_code / 'claude-code'(legacy) → claude，空值默认 claude，其余原样透传。
- 新增 agent：PROVIDER_SPECS 加条目 + 同步 adapters 的 PROTOCOL_PROVIDERS；minVersion 同时登记在 version.ts 的 MIN_VERSIONS。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
