"""Cleanup daemon-instance related tables for D-007 data reset.

Change 2026-07-03-daemon-entity-binding D-007: 允许重置开发/测试数据。
清空 daemon_instances / daemon_runtimes / workspace_member_runtimes 三张表
（按 FK 依赖顺序），使系统回到 daemon-entity-binding 变革前状态。

用法：
    uv run python scripts/cleanup_daemon_instances.py          # 实际执行
    uv run python scripts/cleanup_daemon_instances.py --dry-run  # 仅预览

注意：
- 不会自动 commit（脚本以单独事务运行，退出时回滚除非显式指定 --force）。
- workspace_member_runtimes 清空后 per-member 绑定丢失，用户需重新绑定。
- daemon_runtimes 清空后 task-15 可设 daemon_instance_id 为 NOT NULL。
- daemon_task_leases / daemon_change_writes 的 runtime_id FK 保留（D-003 不动），
  仅清空 daemon_runtimes 会导致这俩表 runtime_id 悬空——按 design §8.2 该两表
  保留旧 runtime_id（V2 再清理）。如希望一并清空，取消下面注释。

符合 CLAUDE.md 规则 10：未正式上线，允许重置。
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Ensure the backend package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, text


def _get_db_url() -> str:
    """Read DATABASE_URL from env; same resolution as app.core.config."""
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        # Try reading from backend/.env if present
        env_path = Path(__file__).resolve().parent.parent / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if line.startswith("DATABASE_URL="):
                    db_url = line.split("=", 1)[1].strip().strip("'\"")
                    break
    if not db_url:
        print("ERROR: DATABASE_URL not set. Provide it via env or backend/.env", file=sys.stderr)
        sys.exit(1)
    return db_url


TABLES_IN_ORDER = [
    # FK 依赖顺序：先子表，后父表
    "workspace_member_runtimes",  # FK -> daemon_instances (RESTRICT)
    "daemon_runtimes",  # FK -> daemon_instances (CASCADE)
    "daemon_instances",  # 根表
]

# 可选的级联清理（design §8.2 默认保留）
EXTRA_TABLES = [
    # "daemon_task_leases",    # runtime_id FK 保留（D-003）
    # "daemon_change_writes",  # runtime_id FK 保留（D-003）
]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cleanup daemon-instance related tables (D-007 reset)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print the SQL statements; do not execute them.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Actually execute the cleanup (without --force the transaction auto-rollbacks).",
    )
    args = parser.parse_args()

    db_url = _get_db_url()
    engine = create_engine(db_url)

    all_tables = list(TABLES_IN_ORDER)
    if args.force:
        all_tables.extend(EXTRA_TABLES)

    print(f"Database URL: {db_url}")
    print(f"Dry run: {args.dry_run}")
    print(f"Force: {args.force}")
    print()
    print("Tables to clear (in order):")
    for t in all_tables:
        print(f"  - {t}")
    print()

    if args.dry_run:
        print("[DRY-RUN] Would execute:")
        for t in all_tables:
            print(f"  TRUNCATE TABLE {t} CASCADE;")
        print()
        print("[DRY-RUN] No changes made.")
        sys.exit(0)

    if not args.force:
        print("WARNING: This will DELETE ALL DATA in the above tables.")
        print("Pass --force to actually execute, or --dry-run to preview.")
        print("Without --force, the transaction will be rolled back automatically.")
        # In non-force mode, proceed but rollback (safety net)

    conn = engine.connect()
    trans = conn.begin()
    try:
        for table in all_tables:
            print(f"  Truncating {table}...")
            conn.execute(text(f"DELETE FROM {table}"))

        if args.force:
            trans.commit()
            print()
            print("SUCCESS: All specified tables cleared.")
        else:
            trans.rollback()
            print()
            print("Rolled back (no --force). No changes made.")
            print("Re-run with --force to commit.")

    except Exception as exc:
        trans.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
