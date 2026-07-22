"""problem 子域 schema 单测。

ql-20260722-003: 验证 ProblemListUpdate 接收 audit_user_id(含清空 null)。
此前 Update 缺该字段, 前端 edit 发的 audit_user_id 被 Pydantic extra=ignore
静默丢弃, 致验证人无法更新/清空。纯 schema 测试, 无需 DB。
"""

from __future__ import annotations

import uuid

from app.modules.ppm.problem.schema import ProblemListUpdate


def test_update_accepts_audit_user_id_value() -> None:
    """显式传 audit_user_id(UUID) → model_dump(exclude_unset) 含该字段。"""
    uid = uuid.uuid4()
    o = ProblemListUpdate.model_validate({"audit_user_id": str(uid)})
    d = o.model_dump(exclude_unset=True)
    assert "audit_user_id" in d
    assert d["audit_user_id"] == uid


def test_update_accepts_audit_user_id_null() -> None:
    """清空验证人: audit_user_id=null → exclude_unset 保留 None(可落库 NULL)。"""
    o = ProblemListUpdate.model_validate({"audit_user_id": None, "remarks": "x"})
    d = o.model_dump(exclude_unset=True)
    assert "audit_user_id" in d
    assert d["audit_user_id"] is None
    assert d["remarks"] == "x"


def test_update_omits_absent_audit_user_id() -> None:
    """请求体不含 audit_user_id → exclude_unset 不含(不影响该字段, 兼容部分更新)。"""
    o = ProblemListUpdate.model_validate({"remarks": "x"})
    d = o.model_dump(exclude_unset=True)
    assert "audit_user_id" not in d
