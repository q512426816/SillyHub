# @generated 由 sillyhub-daemon/scripts/gen-provider-caps.mjs 生成，勿手改；
# 唯一维护源 = sillyhub-daemon/src/interactive/providers.ts 的 PROVIDER_CAPS。
# 重跑生成：node sillyhub-daemon/scripts/gen-provider-caps.mjs（frontend
# `pnpm gen:types` 链尾已自动执行）。
"""provider 能力矩阵（ProviderCaps）Python 镜像表（生成产物）。

镜像约定（三端同步，单源 = daemon 侧，2026-09-11-provider-adapter-registry
task-04 起手抄镜像退役）：

- 唯一维护源是 ``sillyhub-daemon/src/interactive/providers.ts`` 的
  ``PROVIDER_CAPS``（含取值依据的文件:行号锚点注释，改值先改那里）；
- 本文件与 ``frontend/src/lib/provider-caps.ts`` 均为脚本生成产物，daemon
  单源改值后重跑 ``sillyhub-daemon/scripts/gen-provider-caps.mjs`` 三端一并
  刷新，三端键集合（11 键：10 个 boolean + dialog string 枚举）与每个
  provider 每键取值必须一致；
- 一致性由 ``app/modules/agent/tests/test_provider_caps_alignment.py`` 以
  源文件读取方式守护（直接读 daemon / frontend 表源比对，不复制值断言），
  任一端漂移即测试失败；
- 查询语义：未知 provider 返回默认拒绝新 dict（boolean 键全 False、dialog
  string 枚举取 ``"none"``，缺省 false 默认拒绝，FR-06 / D-002@v1），不抛错。
"""

from __future__ import annotations

PROVIDER_CAPS: dict[str, dict[str, bool | str]] = {
    # 取值依据锚点见 daemon 侧 sillyhub-daemon/src/interactive/providers.ts
    # 的 PROVIDER_CAPS docblock。
    "claude": {
        "resume": True,
        "mcp": True,
        "multimodal": True,
        "thinking": True,
        "subagent": True,
        "permission_dialog": True,
        "dialog": "native",
        "edit_patch": True,
        "model_select": True,
        "provider_switch": True,
        "ctx_usage": True,
    },
    "codex": {
        "resume": True,
        "mcp": False,
        "multimodal": False,
        "thinking": False,
        "subagent": False,
        "permission_dialog": True,
        "dialog": "native",
        "edit_patch": False,
        "model_select": True,
        "provider_switch": True,
        "ctx_usage": True,
    },
    "pi": {
        "resume": True,
        "mcp": False,
        "multimodal": True,
        "thinking": True,
        "subagent": False,
        "permission_dialog": True,
        "dialog": "native",
        "edit_patch": False,
        "model_select": True,
        "provider_switch": True,
        "ctx_usage": True,
    },
    "cursor": {
        "resume": True,
        "mcp": False,
        "multimodal": False,
        "thinking": True,
        "subagent": False,
        "permission_dialog": False,
        "dialog": "marker",
        "edit_patch": False,
        "model_select": True,
        "provider_switch": False,
        "ctx_usage": True,
    },
}

# 键序取自镜像表首条目（claude）；11 键齐全与三端一致性由守护测试保证。
_CAPS_KEYS: tuple[str, ...] = tuple(next(iter(PROVIDER_CAPS.values())))


def get_provider_caps(provider: str) -> dict[str, bool | str]:
    """查询 provider 能力矩阵。

    Args:
        provider: provider 标识（detector key，如 ``"claude"`` / ``"codex"``）。

    Returns:
        dict[str, bool | str]: 已知 provider 返回表内条目的**副本**（调用方可安全
        修改，不污染模块级共享表）；未知 provider 返回默认拒绝新 dict（boolean
        键全 False、dialog string 枚举取 ``"none"``，11 键齐全，FR-06），不抛错。
    """
    caps = PROVIDER_CAPS.get(provider)
    if caps is not None:
        return dict(caps)
    # 未知 provider 默认拒绝：boolean 键全 False，dialog string 枚举回退 'none'。
    return {key: ("none" if key == "dialog" else False) for key in _CAPS_KEYS}
