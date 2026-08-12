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
