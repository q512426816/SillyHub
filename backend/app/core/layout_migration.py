"""One-time layout migration: legacy ``changes/change/<key>/`` → v4 ``changes/<key>/``.

Can be run standalone or called during application startup.
Idempotent — safe to run multiple times.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from app.core.logging import get_logger
from app.core.spec_paths import SpecPathResolver

log = get_logger(__name__)


def migrate_layout(workspace_root: str | Path) -> dict:
    """Migrate legacy SillySpec layout to v4.

    Returns a summary dict with counts of migrated items.
    """
    resolver = SpecPathResolver(workspace_root)
    changes_root = resolver.changes_root()
    stats: dict = {
        "dirs_moved": 0,
        "verification_renamed": 0,
        "archive_migrated": 0,
        "stray_gate_status_removed": 0,
        "errors": [],
    }

    if not changes_root.is_dir():
        log.info("migration.skipped", reason="No .sillyspec/changes/ directory")
        return stats

    # --- 1. Move changes/change/<key>/ → changes/<key>/ ---
    legacy_base = resolver.legacy_change_dir("").parent  # changes/change/
    if legacy_base.is_dir():
        for entry in list(legacy_base.iterdir()):
            if entry.name.startswith(".") or not entry.is_dir():
                continue
            target = resolver.change_dir(entry.name)
            if target.exists():
                log.warning(
                    "migration.skip_conflict",
                    change_key=entry.name,
                    reason="Target already exists",
                )
                continue
            try:
                shutil.move(str(entry), str(target))
                stats["dirs_moved"] += 1
                log.info("migration.moved_change", change_key=entry.name)
            except OSError as exc:
                stats["errors"].append(f"move {entry.name}: {exc}")
                log.error("migration.move_failed", change_key=entry.name, error=str(exc))

        # Remove empty legacy base dir
        try:
            legacy_base.rmdir()  # only succeeds if empty
            log.info("migration.removed_legacy_dir", path=str(legacy_base))
        except OSError:
            pass  # not empty or other error, leave it

    # --- 2. Rename verification.md → verify-result.md in active changes ---
    for change_entry in _iter_change_dirs(changes_root):
        legacy_file = change_entry / "verification.md"
        canonical_file = change_entry / SpecPathResolver.VERIFY_RESULT
        if legacy_file.is_file() and not canonical_file.exists():
            try:
                legacy_file.rename(canonical_file)
                stats["verification_renamed"] += 1
                log.info(
                    "migration.renamed_verification",
                    path=str(change_entry.relative_to(changes_root)),
                )
            except OSError as exc:
                stats["errors"].append(f"rename verification in {change_entry.name}: {exc}")

    # --- 3. Move active changes with archived stage into changes/archive/ ---
    archive_dir = resolver.archive_dir()
    for change_entry in _iter_change_dirs(changes_root):
        # Check if this change is already in archive
        if archive_dir in change_entry.parents:
            continue

        master_path = change_entry / "MASTER.md"
        if master_path.is_file():
            try:
                import frontmatter

                post = frontmatter.load(str(master_path))
                if post.metadata.get("status") == "archived":
                    dest = resolver.archive_dir(change_entry.name)
                    if dest.exists():
                        continue
                    archive_dir.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(change_entry), str(dest))
                    stats["archive_migrated"] += 1
                    log.info(
                        "migration.migrated_archive",
                        change_key=change_entry.name,
                    )
            except Exception as exc:
                stats["errors"].append(f"archive check {change_entry.name}: {exc}")

    # --- 4. Remove stray gate-status.json in workspace root ---
    stray_gate = resolver.root / "gate-status.json"
    if stray_gate.is_file():
        correct_location = resolver.gate_status_path()
        if not correct_location.is_file():
            try:
                correct_location.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(stray_gate), str(correct_location))
                stats["stray_gate_status_removed"] += 1
                log.info("migration.moved_gate_status")
            except OSError as exc:
                stats["errors"].append(f"move gate-status.json: {exc}")
        else:
            try:
                stray_gate.unlink()
                stats["stray_gate_status_removed"] += 1
                log.info("migration.removed_stray_gate_status")
            except OSError as exc:
                stats["errors"].append(f"remove stray gate-status.json: {exc}")

    log.info("migration.complete", **stats)
    return stats


def _iter_change_dirs(changes_root: Path):
    """Iterate over active change directories, skipping ``archive/``."""
    if not changes_root.is_dir():
        return
    for entry in sorted(changes_root.iterdir()):
        if entry.name.startswith(".") or not entry.is_dir():
            continue
        if entry.name == "archive":
            continue
        yield entry
