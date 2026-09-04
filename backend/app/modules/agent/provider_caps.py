# 与 sillyhub-daemon/src/interactive/providers.ts 保持镜像，守护测试比对，修改须三端同步。
"""provider 能力矩阵（ProviderCaps）Python 镜像表。

出处：2026-09-03-agent-provider-abstraction task-02（design §5.2）。

镜像约定（单源 = daemon 侧）：

- 唯一维护源是 ``sillyhub-daemon/src/interactive/providers.ts`` 的
  ``PROVIDER_CAPS``（含取值依据的文件:行号锚点注释，改值先改那里）；
- 本文件与 ``frontend/src/lib/provider-caps.ts`` 为手工镜像，三端键集合
  （8 键）与每个 provider 每键取值必须一致；
- 一致性由 ``app/modules/agent/tests/test_provider_caps_alignment.py`` 以
  源文件读取方式守护（直接读 daemon / frontend 表源比对，不复制值断言），
  任一端漂移即测试失败；
- 查询语义：未知 provider 返回全 False 新 dict（缺省 false 默认拒绝，
  FR-06 / D-002@v1），不抛错。
"""

from __future__ import annotations

PROVIDER_CAPS: dict[str, dict[str, bool]] = {
    # 取值依据锚点见 daemon 侧 sillyhub-daemon/src/interactive/providers.ts
    # 的 PROVIDER_CAPS docblock（2026-09-03 task-02 实读现状硬编码门控）。
    "claude": {
        "resume": True,
        "mcp": True,
        "multimodal": True,
        "thinking": True,
        "subagent": True,
        "permission_dialog": True,
        "edit_patch": True,
        "model_select": True,
    },
    "codex": {
        "resume": True,
        "mcp": False,
        "multimodal": False,
        "thinking": False,
        "subagent": False,
        "permission_dialog": True,
        "edit_patch": False,
        "model_select": True,
    },
    # pi（2026-09-04-provider-pi-onboarding task-04 / design §5.3）：取值依据
    # 锚点见 daemon 侧 providers.ts 的 PROVIDER_CAPS docblock pi 段；
    # subagent 初始 False（§6.2 纪律，实证后只由 task-06 在三端同步翻值）。
    "pi": {
        "resume": True,
        "mcp": False,
        "multimodal": True,
        "thinking": True,
        "subagent": False,
        "permission_dialog": False,
        "edit_patch": False,
        "model_select": True,
    },
}

# 键序取自镜像表首条目（claude）；8 键齐全与三端一致性由守护测试保证。
_CAPS_KEYS: tuple[str, ...] = tuple(next(iter(PROVIDER_CAPS.values())))


def get_provider_caps(provider: str) -> dict[str, bool]:
    """查询 provider 能力矩阵。

    Args:
        provider: provider 标识（detector key，如 ``"claude"`` / ``"codex"``）。

    Returns:
        dict[str, bool]: 已知 provider 返回表内条目的**副本**（调用方可安全
        修改，不污染模块级共享表）；未知 provider 返回全 False 新 dict
        （8 键齐全，缺省 false 默认拒绝），不抛错。
    """
    caps = PROVIDER_CAPS.get(provider)
    if caps is not None:
        return dict(caps)
    return {key: False for key in _CAPS_KEYS}
