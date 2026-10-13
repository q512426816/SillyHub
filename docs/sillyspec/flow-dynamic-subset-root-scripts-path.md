# flow done 动态测试子集把主仓根 scripts 测试拼进 backend pytest 命令（cwd 相对路径错位）

> 记录时间：2026-10-13 · 来源变更：2026-10-13-turn-live-visibility（flow done 实测实证）
> 状态：活跃坑（有确定性绕过，待工具修复）

## 现象

flow done 的动态测试子集（deps 推断）把 `scripts/test_scan_drift_check.py`（主仓根
`scripts/`）拼进了 **backend 子目录的 pytest 命令**：

```
cd backend && uv run pytest app/modules/... scripts/test_scan_drift_check.py
→ ERROR: file or directory not found: scripts/test_scan_drift_check.py
```

该文件真实存在于主仓根 `scripts/test_scan_drift_check.py`（git 515ac5899 引入），但
pytest 在 `backend` cwd 下按相对路径解析必然找不到 → 整批 pytest 命令 exit 2 →
测试门 FAIL。2026-10-13-turn-live-visibility 收口实测实证（verify-runs
20261013041249）。

## 根因

动态子集推断按 runner 分批（auto-py 批统一 `cd backend && uv run pytest …`），但
文件面收集不区分测试文件所属包根：主仓根 `scripts/` 的 pytest 文件与 backend 包内
测试混入同一命令，相对路径只在主仓根 cwd 下成立。

## 影响

- 只要动态子集拉到根目录 scripts 测试，backend 批必假败，flow done 测试门整单
  FAIL（fail-closed）；
- 与真实失败叠加时污染 failure_remaining，掩盖/混淆归属判断。

## 绕过

- 收口前确认 `failure_remaining` 里该行是唯一的 backend 侧失败且其余失败可归属
  他侧（并行变更/既有豁免），按污染归属口径忽略该行，不为本行改代码；
- 或临时在 local.yaml known_failures 锚定该行（`^ERROR: file or directory not
  found: scripts/test_scan_drift_check.py`），收口后移除。

## 待工具修复

deps 推断给 auto-py 批收集文件时按「最近 pyproject/uv 祖先」分包根（与 runner
推断同款策略），根目录 scripts 的 pytest 文件应生成独立批（cwd=主仓根）或改绝对
路径引用。
