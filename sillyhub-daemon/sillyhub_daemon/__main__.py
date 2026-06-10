"""CLI entry point for sillyhub-daemon.

Provides ``start``, ``stop``, ``status`` and ``logs`` sub-commands built on
Click.  Run via ``python -m sillyhub_daemon`` or the ``sillyhub-daemon``
console script.

Design reference: design.md section 4.3 CLI Commands.
"""

from __future__ import annotations

import asyncio
import sys

import click

from sillyhub_daemon.config import DaemonConfig, DEFAULT_CONFIG_DIR

# Paths used by stop / status / logs
_PID_FILE = DEFAULT_CONFIG_DIR / "daemon.pid"
_LOG_FILE = DEFAULT_CONFIG_DIR / "daemon.log"


# ── Helpers ──────────────────────────────────────────────────────────────────


def _read_pid() -> int | None:
    """Return the PID stored on disk, or *None* if the file is absent."""
    try:
        return int(_PID_FILE.read_text().strip())
    except (OSError, ValueError):
        return None


def _is_process_alive(pid: int) -> bool:
    """Check whether *pid* refers to a running process (cross-platform)."""
    import os

    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _write_pid(pid: int) -> None:
    """Persist the current process PID."""
    _PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PID_FILE.write_text(str(pid))


def _remove_pid() -> None:
    """Remove the PID file (best-effort)."""
    try:
        _PID_FILE.unlink(missing_ok=True)
    except OSError:
        pass


# ── CLI group ────────────────────────────────────────────────────────────────


@click.group()
def cli():
    """SillyHub Daemon - local task execution daemon."""


# ── start ────────────────────────────────────────────────────────────────────


@cli.command()
@click.option("--server", default=None, help="Server URL (e.g. http://localhost:8000)")
@click.option("--token", default=None, help="Bearer token for server authentication")
def start(server, token):
    """Start the daemon."""
    from sillyhub_daemon.client import HubClient
    from sillyhub_daemon.credential import CredentialManager
    from sillyhub_daemon.daemon import Daemon
    from sillyhub_daemon.task_runner import TaskRunner
    from sillyhub_daemon.workspace import WorkspaceManager

    config = DaemonConfig()
    if server:
        config.server_url = server
    if token:
        config.token = token
    config.save()

    if not config.token:
        click.echo("Error: --token is required. Get one from the SillyHub web UI.")
        sys.exit(1)

    click.echo(f"Starting SillyHub daemon (server={config.server_url})...")
    click.echo(f"Runtime ID: {config.runtime_id}")

    client = HubClient(config.server_url, token=config.token)
    workspace_mgr = WorkspaceManager()
    credential_mgr = CredentialManager()
    task_runner = TaskRunner(client, workspace_mgr, credential_mgr)
    daemon = Daemon(config, client, task_runner=task_runner)

    # Persist PID for stop / status commands
    import os

    _write_pid(os.getpid())

    try:
        asyncio.run(daemon.start())
    except KeyboardInterrupt:
        click.echo("\nShutting down...")
        asyncio.run(daemon.stop())
    finally:
        _remove_pid()


# ── stop ─────────────────────────────────────────────────────────────────────


@cli.command()
def stop():
    """Stop the daemon (sends SIGTERM to the running daemon process)."""
    import os
    import signal

    pid = _read_pid()
    if pid is None:
        click.echo("No PID file found. Is the daemon running?")
        sys.exit(1)

    if not _is_process_alive(pid):
        click.echo(f"Process {pid} is not running (stale PID file removed).")
        _remove_pid()
        sys.exit(1)

    try:
        os.kill(pid, signal.SIGTERM)
        click.echo(f"Sent SIGTERM to daemon (PID {pid}).")
    except PermissionError:
        click.echo(f"Permission denied: cannot signal process {pid}.", err=True)
        sys.exit(1)


# ── status ───────────────────────────────────────────────────────────────────


@cli.command()
def status():
    """Show daemon status."""
    config = DaemonConfig()

    pid = _read_pid()
    if pid is not None and _is_process_alive(pid):
        state = "running"
        pid_info = str(pid)
    elif pid is not None:
        state = "stopped (stale PID)"
        pid_info = f"{pid} (dead)"
    else:
        state = "stopped"
        pid_info = "-"

    click.echo(f"State:       {state}")
    click.echo(f"PID:         {pid_info}")
    click.echo(f"Runtime ID:  {config.runtime_id}")
    click.echo(f"Server URL:  {config.server_url}")
    click.echo(f"Config dir:  {DEFAULT_CONFIG_DIR}")


# ── logs ─────────────────────────────────────────────────────────────────────


@cli.command()
@click.option("--tail", default=50, help="Number of lines to show")
def logs(tail):
    """Show daemon logs."""
    if not _LOG_FILE.exists():
        click.echo(f"No log file found at {_LOG_FILE}")
        click.echo("Start the daemon first to generate logs.")
        return

    try:
        lines = _LOG_FILE.read_text(encoding="utf-8").splitlines()
        for line in lines[-tail:]:
            click.echo(line)
    except OSError as exc:
        click.echo(f"Error reading log file: {exc}", err=True)
        sys.exit(1)


# ── entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cli()
