"""classifier.py 单元测试（ql-20260812-006）。"""

from app.modules.change_writer.classifier import classify_change_type


def test_classify_quick_by_keywords():
    """命中 quick 关键词 → 'quick'。"""
    assert classify_change_type("fix typo in README") == "quick"
    assert classify_change_type("改文案：把按钮文字改成中文") == "quick"
    assert classify_change_type("样式调整：按钮颜色微调") == "quick"
    assert classify_change_type("hotfix: 紧急修复登录问题") == "quick"


def test_classify_prototype_by_keywords():
    """命中 prototype 关键词 → 'prototype'。"""
    assert classify_change_type("做一个原型验证一下") == "prototype"
    assert classify_change_type("POC: 尝试新的架构方案") == "prototype"
    assert classify_change_type("demo 演示用的小工具") == "prototype"
    assert classify_change_type("探索一下新的实现方式") == "prototype"


def test_classify_feature_by_default():
    """无关键词命中 → 默认 'feature'。"""
    assert classify_change_type("添加用户登录功能") == "feature"
    assert classify_change_type("实现订单管理模块") == "feature"
    assert classify_change_type("优化数据库查询性能") == "feature"


def test_classify_case_insensitive():
    """大小写不敏感。"""
    assert classify_change_type("FIX TYPO in README") == "quick"
    assert classify_change_type("Prototype for New Feature") == "prototype"


def test_classify_empty_description():
    """空描述 → 默认 'feature'。"""
    assert classify_change_type("") == "feature"


# ── ql-20260812-007（2026-08-12-quick-independent-stage）：quick 独立阶段 ──


def test_stageenum_quick_member():
    """StageEnum 含 QUICK 辅助阶段，值为 'quick'。"""
    from app.modules.change.model import StageEnum

    assert StageEnum.QUICK.value == "quick"


def test_stageenum_spec_auxiliary_stages_contains_quick():
    """spec_auxiliary_stages() 含 QUICK（quick 是辅助阶段，独立流程）。"""
    from app.modules.change.model import StageEnum

    aux = StageEnum.spec_auxiliary_stages()
    assert StageEnum.QUICK in aux


def test_stageenum_spec_stages_excludes_quick():
    """spec_stages() 仍是主线 5 阶段，不含 quick（保 dispatch.STAGE_ORDER 断言成立）。

    design D-002：quick 放 auxiliary，不进主线上下游判定，故 spec_stages 排除 quick。
    """
    from app.modules.change.model import StageEnum

    main_stages = StageEnum.spec_stages()
    assert StageEnum.QUICK not in main_stages
    assert [s.value for s in main_stages] == [
        "brainstorm",
        "plan",
        "execute",
        "verify",
        "archive",
    ]


def test_dispatch_stage_agent_config_has_quick():
    """STAGE_AGENT_CONFIG 含 quick 配置（generic manual_dispatch 据此派发 quick agent）。"""
    from app.modules.change.dispatch import STAGE_AGENT_CONFIG

    assert "quick" in STAGE_AGENT_CONFIG
    cfg = STAGE_AGENT_CONFIG["quick"]
    assert cfg.enabled is True
    assert cfg.prompt_template == "quick.md"
    assert cfg.read_only is False


def test_quick_classify_maps_to_quick_stage():
    """分流映射：描述含 quick 关键词 → change_type='quick' → initial_stage='quick'。

    验证创建分流的分类输入端（service/proxy 用同一表达式
    ``initial_stage = 'quick' if change_type == 'quick' else 'brainstorm'``）。
    """
    # quick 关键词 → quick
    assert classify_change_type("快速修复登录按钮文案") == "quick"
    # 非 quick → feature → brainstorm
    assert classify_change_type("实现用户管理模块") == "feature"
    # 分流表达式：change_type 决定 initial_stage
    for desc in ("快速修复登录按钮文案", "fix typo in readme"):
        change_type = classify_change_type(desc)
        initial_stage = "quick" if change_type == "quick" else "brainstorm"
        assert initial_stage == "quick", f"quick 描述应分流到 quick 阶段: {desc}"
    for desc in ("实现用户管理模块", "优化数据库性能"):
        change_type = classify_change_type(desc)
        initial_stage = "quick" if change_type == "quick" else "brainstorm"
        assert initial_stage == "brainstorm", f"非 quick 描述应分流到 brainstorm: {desc}"
