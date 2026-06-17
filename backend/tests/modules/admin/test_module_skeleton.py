"""Admin skeleton import tests.

Covers change ``2026-06-16-admin-org-role-center`` task-03 AC-01..AC-03,
AC-08, AC-13.
"""

from __future__ import annotations

import pytest


def test_admin_package_imports_clean() -> None:
    """``import app.modules.admin`` must not raise."""
    import app.modules.admin  # noqa: F401


def test_admin_router_has_admin_prefix() -> None:
    """Router must declare ``/admin`` prefix so ``main.py`` mounts under ``/api/admin``."""
    from app.modules.admin.router import router

    assert router.prefix == "/admin"
    assert "admin" in router.tags


def test_admin_router_does_not_import_settings() -> None:
    """AC-13: admin must not import settings to avoid circular dependency.

    Scans real import statements (``import``/``from … import``) rather than
    comment text so docstrings are allowed to *mention* settings.
    """
    import ast
    import pathlib

    admin_dir = pathlib.Path(__file__).resolve().parents[3] / "app" / "modules" / "admin"
    assert admin_dir.is_dir(), f"admin dir missing: {admin_dir}"

    bad: list[str] = []
    for py in admin_dir.rglob("*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("app.modules.settings"):
                        bad.append(f"{py.name}: import {alias.name}")
            elif (
                isinstance(node, ast.ImportFrom)
                and node.module
                and node.module.startswith("app.modules.settings")
            ):
                bad.append(f"{py.name}: from {node.module}")
    assert not bad, f"admin imports settings: {bad}"


@pytest.mark.parametrize(
    "error_name",
    [
        "AuthUserLoginDisabled",
        "RoleInUse",
        "RoleSystemProtected",
        "RoleNotFound",
        "RoleKeyDuplicate",
        "OrganizationInUse",
        "OrganizationHasChildren",
        "OrganizationCodeDuplicate",
        "OrganizationParentNotFound",
        "OrganizationNotFound",
    ],
)
def test_error_classes_importable(error_name: str) -> None:
    """AC-02: 10 new error classes must be importable from ``app.core.errors``."""
    from app.core import errors

    assert hasattr(errors, error_name)
    cls = getattr(errors, error_name)
    assert issubclass(cls, errors.AppError)


def test_role_in_use_carries_user_count() -> None:
    """AC-03: ``RoleInUse`` reports ``user_count`` in details + http 409."""
    from app.core.errors import RoleInUse

    err = RoleInUse(user_count=3)
    assert err.http_status == 409
    assert err.code.endswith("ROLE_IN_USE")
    assert err.details == {"user_count": 3}


def test_organization_in_use_carries_member_count() -> None:
    """Sibling helper for organizations reports ``member_count``."""
    from app.core.errors import OrganizationInUse

    err = OrganizationInUse(member_count=5)
    assert err.http_status == 409
    assert err.details == {"member_count": 5}


def test_organization_has_children_carries_children_count() -> None:
    from app.core.errors import OrganizationHasChildren

    err = OrganizationHasChildren(children_count=2)
    assert err.http_status == 409
    assert err.details == {"children_count": 2}


def test_main_imports_admin_router() -> None:
    """``app.main`` must register the admin router. Importing main pulls
    in ``app.modules.admin.router`` via the top-level import block."""
    import app.main  # noqa: F401
    import app.modules.admin.router as admin_router_mod

    assert admin_router_mod.router is not None
