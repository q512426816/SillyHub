---
schema_version: 1
doc_type: module-card
module_id: version
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 版本号解析与校验（version）

## 定位
semver 解析与最低版本校验的纯函数工具（`src/version.ts`，Python `version.py` 1:1 Node 迁移）。为 agent-detector（解析 `<bin> --version` 输出）与 preflight（sillyspec CLI 版本门控）提供「提取三元组 + 比最低线」能力。零依赖（G-05，不引 semver 库，手写 RegExp + 数值比较）。

## 契约摘要
- `SemVerTuple`：`readonly [major, minor, patch]`。
- `MIN_VERSIONS`：`{ claude:[2,0,0], codex:[0,100,0], copilot:[1,0,0] }`——仅 3 个 provider 有门槛，其余无 entry 即无要求；新增版本限制在此加。
- `parseSemver(raw?): SemVerTuple | null`——从任意字符串提取第一个 semver 三元组；null/空串/未匹配返回 null。
- `formatSemver(tuple): string`——"major.minor.patch"；入参假定合法，不防御。
- `checkMinVersion(provider, version): string | null`——低于最低线返回英文警告文本，否则 null。

## 关键逻辑
```
SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/   // 模块级常量，等价 Python re.search（无锚定）
parseSemver: raw 空→null；exec 取首匹配→[Number×3]；未匹配→null
checkMinVersion 三段短路:
  MIN_VERSIONS 无 entry → null（无要求）
  parseSemver 失败      → null（无法比较，不叠加噪声）
  compareTuple(parsed, minVer) < 0 → `${provider} version ${version} is below minimum required version ${formatSemver(minVer)}`
```

## 注意事项
- search 语义（非锚定）：可处理前导文本，"Claude Code 2.1.5" → [2,1,5]、"v2.0.0" → [2,0,0]。
- 正则不含 prerelease 捕获：`0.118.0-rc.1` 解析为 (0,118,0)，后缀被忽略——Python 版既定行为，Node 严格保持，勿"顺手修"。
- 警告文本中的 version 用**原始字符串**（非 formatSemver 后），保留用户传入形态便于排查；文本格式与 Python f-string 逐字对齐。
- `compareTuple` 是内部函数不导出（字典序逐元素比较，对齐 Python tuple 比较语义）。
- 与 daemon-version（DAEMON_VERSION 常量）是两个模块：本模块只做 semver 纯函数，不含 daemon 自身版本号。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
