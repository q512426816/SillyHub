"""Configuration management for SillyHub daemon.

Handles loading, saving, and accessing daemon configuration from
``~/.sillyhub/daemon/config.json``.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any


DEFAULT_CONFIG_DIR = Path.home() / ".sillyhub" / "daemon"
DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_DIR / "config.json"


class DaemonConfig:
    """Configuration management for SillyHub daemon."""

    DEFAULTS: dict[str, Any] = {
        "server_url": "http://localhost:8000",
        "token": None,  # Bearer token for server auth
        "runtime_id": None,  # auto-generated
        "profile": "default",
        "workspace_dir": str(Path.home() / "sillyhub_workspaces"),
        "poll_interval": 30,
        "heartbeat_interval": 15,
        "max_concurrent_tasks": 5,
        "log_level": "info",
    }

    def __init__(self, config_path: Path | None = None) -> None:
        self._path = config_path or DEFAULT_CONFIG_PATH
        self._data: dict[str, Any] = dict(self.DEFAULTS)
        self._load()

    # -- persistence ----------------------------------------------------------

    def _load(self) -> None:
        """Load config from file, creating default if not exists."""
        if self._path.exists():
            with open(self._path, encoding="utf-8") as f:
                saved = json.load(f)
                self._data.update(saved)

        # Auto-generate runtime_id if missing
        if not self._data.get("runtime_id"):
            self._data["runtime_id"] = str(uuid.uuid4())
            self.save()

    def save(self) -> None:
        """Save current config to file."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, indent=2)

    # -- property accessors ---------------------------------------------------

    @property
    def server_url(self) -> str:
        return self._data["server_url"]

    @server_url.setter
    def server_url(self, value: str) -> None:
        self._data["server_url"] = value

    @property
    def token(self) -> str | None:
        return self._data.get("token")

    @token.setter
    def token(self, value: str | None) -> None:
        self._data["token"] = value

    @property
    def runtime_id(self) -> str:
        return self._data["runtime_id"]

    @property
    def workspace_dir(self) -> str:
        return self._data["workspace_dir"]

    @workspace_dir.setter
    def workspace_dir(self, value: str) -> None:
        self._data["workspace_dir"] = value

    @property
    def poll_interval(self) -> int:
        return self._data["poll_interval"]

    @property
    def heartbeat_interval(self) -> int:
        return self._data["heartbeat_interval"]

    @property
    def max_concurrent_tasks(self) -> int:
        return self._data["max_concurrent_tasks"]

    @property
    def log_level(self) -> str:
        return self._data["log_level"]

    @log_level.setter
    def log_level(self, value: str) -> None:
        self._data["log_level"] = value

    # -- generic access -------------------------------------------------------

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._data[key] = value
        self.save()

    def to_dict(self) -> dict[str, Any]:
        return dict(self._data)
