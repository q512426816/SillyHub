---
schema_version: 1
doc_type: module-card
module_id: version
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# version

## 定位
semver 解析与最低版本校验的纯函数工具（Python `version.py` 1:1 迁移）。为 agent-detector 提供「解析 agent CLI 版本字符串 + 判断是否达最低要求」能力：探测到 provider 二进制后执行 `<bin> --version` 取 stdout，经 parseSemver 提取三元组，再用 checkMinVersion 与 MIN_VERSIONS 比较。零依赖（G-05，不引 semver 库）。

## 契约摘要
- `SemVerTuple`：`readonly [major, minor, patch]`。
- `MIN_VERSIONS`：`{ claude:[2,0,0], codex:[0,100,0], copilot:[1,0,0] }`（仅 3 provider 有门槛）。
- `parseSemver(raw?): SemVerTuple | null`：从任意字符串提取第一个 semver 三元组。
- `formatSemver(tuple): string`：格式化为 "major.minor.patch"。
- `checkMinVersion(provider, version): string | null`：低于最低版本返回警告文本，否则 null。

## 关键逻辑
```
// 模块级正则（避免每次编译）
SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/

parseSemver(raw):
  if !raw → null
  m = SEMVER_RE.exec(raw)          // search 语义，非锚定，可处理前缀
  if !m → null
  return [Number(m[1]), Number(m[2]), Number(m[3])]

checkMinVersion(provider, version):   // 三段短路（顺序对齐 Python）
  minVer = MIN_VERSIONS[provider]      // 1) 无 entry → null（无要求）
  if minVer === undefined → return null
  parsed = parseSemver(version)        // 2) 无法解析 → null（不叠加噪声）
  if parsed === null → return null
  if parsed < minVer → return `${provider} version ${version} is below minimum required version ${formatSemver(minVer)}`
  return null                          // 3) 达标
```

## 注意事项
- SEMVER_RE 不匹配 prerelease 后缀（如 `0.118.0-rc.1` → `(0,118,0)`），这是 Python 版既定行为，Node 严格保持一致。
- search 语义（非 match）：可处理前导文本，如 "Claude Code 2.1.5" → [2,1,5]、"v2.0.0" → [2,0,0]。
- 警告文本中的 version 用**原始字符串**（非 formatSemver 后），保留用户传入形态便于排查；文本格式与 Python f-string 逐字对齐。
- MIN_VERSIONS 仅 3 provider 有门槛，其余 provider 无 entry 直接返回 null（无要求）；新增 provider 版本限制需在此添加。
- 被 agent-detector 使用，也经 src/index.ts 重导出。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
