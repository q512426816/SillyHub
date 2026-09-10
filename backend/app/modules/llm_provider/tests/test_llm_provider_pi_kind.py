"""task-04（change 2026-09-10-review-dispatch-platform-fixes）schema 放开 pi 测试。

覆盖 task-04 acceptance（FR-03 / D-002@v1）：

- ``LlmProviderCreate.agent_kind`` 放开 ``pi``（平台 worker 独立配额池凭证，
  D-002@v1 账号级隔离的 backend 前提）；
- ``auth_field`` 三处（Create/Update/FetchModelsRequest）由双字面量泛化为
  env 变量名 pattern（``^[A-Z][A-Z0-9_]*$``），pi 用如 ZAI_API_KEY /
  OPENROUTER_API_KEY（design §5.2 缺口1）；
- claude 旧值/缺省零回归（缺省 ANTHROPIC_AUTH_TOKEN、旧两字面量照常可传，
  Update/FetchModels 的 None=不动语义不变）。

纯 pydantic 校验用例，不触 DB / service / router（schema 层单测即可裁决）。
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.modules.llm_provider.schema import (
    FetchModelsRequest,
    LlmProviderCreate,
    LlmProviderUpdate,
)

# LlmProviderCreate.name 为必填字段（与本 task 放开项无关），统一占位。
_NAME = "pool"

# ── 1. pi 可建（agent_kind 放开，D-002@v1）────────────────────────────────────


class TestPiKindCreatable:
    def test_pi_kind_with_env_auth_field_valid(self) -> None:
        """agent_kind=pi + env 名 auth_field → 校验通过（独立配额池凭证行）。"""
        dto = LlmProviderCreate(name=_NAME, agent_kind="pi", auth_field="ZAI_API_KEY")
        assert dto.agent_kind == "pi"
        assert dto.auth_field == "ZAI_API_KEY"

    @pytest.mark.parametrize(
        "auth_field", ["ZAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"]
    )
    def test_pi_env_name_shapes_valid(self, auth_field: str) -> None:
        """设计 §5.2 点名的三个 env 名均可作为 pi 凭证 auth_field。"""
        dto = LlmProviderCreate(name=_NAME, agent_kind="pi", auth_field=auth_field)
        assert dto.auth_field == auth_field

    def test_pi_without_auth_field_keeps_default(self) -> None:
        """pi 不传 auth_field → 沿用缺省 ANTHROPIC_AUTH_TOKEN（缺省语义不变）。"""
        dto = LlmProviderCreate(name=_NAME, agent_kind="pi")
        assert dto.auth_field == "ANTHROPIC_AUTH_TOKEN"

    def test_unknown_kind_still_rejected(self) -> None:
        """值域只放开 pi：其余字面量（如 codex）仍被 Literal 拒。"""
        with pytest.raises(ValidationError):
            LlmProviderCreate(name=_NAME, agent_kind="codex")


# ── 2. auth_field pattern（Create：非法 env 名拒绝清单）───────────────────────


class TestCreateAuthFieldPattern:
    @pytest.mark.parametrize(
        "bad",
        [
            "zai_key",  # 小写
            "ANTHROPIC KEY",  # 空格
            "ANTHROPIC-API-KEY",  # 连字符
            "",  # 空串
            "_ZAI_KEY",  # 下划线开头
        ],
    )
    def test_invalid_env_names_rejected(self, bad: str) -> None:
        """非 env 变量名形状（小写/空格/连字符/空串/下划线开头）→ ValidationError。"""
        with pytest.raises(ValidationError):
            LlmProviderCreate(name=_NAME, auth_field=bad)

    def test_digit_inside_valid(self) -> None:
        """大写开头后接数字/下划线合法（env 名形状允许）。"""
        assert LlmProviderCreate(name=_NAME, auth_field="ZAI_KEY_2").auth_field == "ZAI_KEY_2"


# ── 3. claude 零回归（缺省与旧值逐字不变）─────────────────────────────────────


class TestClaudeZeroRegression:
    def test_defaults_unchanged(self) -> None:
        """不传可选字段：agent_kind=claude、auth_field=ANTHROPIC_AUTH_TOKEN。"""
        dto = LlmProviderCreate(name="legacy")
        assert dto.agent_kind == "claude"
        assert dto.auth_field == "ANTHROPIC_AUTH_TOKEN"

    def test_legacy_literals_still_valid(self) -> None:
        """旧双字面量（改前唯一合法值）在 pattern 下照常可传。"""
        assert LlmProviderCreate(name=_NAME, auth_field="ANTHROPIC_API_KEY").auth_field == (
            "ANTHROPIC_API_KEY"
        )
        assert LlmProviderCreate(name=_NAME, auth_field="ANTHROPIC_AUTH_TOKEN").auth_field == (
            "ANTHROPIC_AUTH_TOKEN"
        )

    def test_claude_kind_still_valid(self) -> None:
        assert LlmProviderCreate(name=_NAME, agent_kind="claude").agent_kind == "claude"


# ── 4. Update / FetchModelsRequest 同 pattern（三处同款放宽）──────────────────


class TestUpdateAuthFieldPattern:
    def test_update_valid_env_name(self) -> None:
        assert LlmProviderUpdate(auth_field="OPENROUTER_API_KEY").auth_field == (
            "OPENROUTER_API_KEY"
        )

    @pytest.mark.parametrize("bad", ["zai_key", "ANTHROPIC KEY", "ANTHROPIC-API-KEY", ""])
    def test_update_invalid_rejected(self, bad: str) -> None:
        with pytest.raises(ValidationError):
            LlmProviderUpdate(auth_field=bad)

    def test_update_none_means_keep(self) -> None:
        """None=不动原密钥语义保留：缺省 None 校验通过。"""
        assert LlmProviderUpdate().auth_field is None

    def test_update_legacy_literals_valid(self) -> None:
        assert LlmProviderUpdate(auth_field="ANTHROPIC_API_KEY").auth_field == ("ANTHROPIC_API_KEY")


class TestFetchModelsAuthFieldPattern:
    def test_inline_form_valid_env_name(self) -> None:
        """新建态形态②：base_url+api_key+auth_field=env 名校验通过。"""
        req = FetchModelsRequest(
            base_url="https://x.example", api_key="sk-x", auth_field="ZAI_API_KEY"
        )
        assert req.auth_field == "ZAI_API_KEY"

    @pytest.mark.parametrize("bad", ["zai_key", "ANTHROPIC KEY", "ANTHROPIC-API-KEY", ""])
    def test_inline_form_invalid_rejected(self, bad: str) -> None:
        with pytest.raises(ValidationError):
            FetchModelsRequest(base_url="https://x.example", api_key="sk-x", auth_field=bad)

    def test_none_keeps_omitted_semantics(self) -> None:
        """auth_field 缺省 None（编辑态从 provider 行读）语义不变。"""
        req = FetchModelsRequest(base_url="https://x.example", api_key="sk-x")
        assert req.auth_field is None

    def test_legacy_literals_valid(self) -> None:
        req = FetchModelsRequest(
            base_url="https://x.example", api_key="sk-x", auth_field="ANTHROPIC_API_KEY"
        )
        assert req.auth_field == "ANTHROPIC_API_KEY"
