"""Local credential storage and placeholder rendering.

Design reference: design section 4.2.3 — user secrets never leave the
local machine.  The server only sends config templates containing
``{{USER_*}}`` placeholders; the daemon resolves them against a local
credentials file and/or environment variables before passing them to
agent subprocesses.

Credentials file: ``~/.sillyhub/daemon/credentials.json`` (mode 0600).
"""

from __future__ import annotations

import json
import logging
import os
import stat
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_CREDENTIALS_PATH = Path.home() / ".sillyhub" / "daemon" / "credentials.json"


class CredentialManager:
    """Manages local credential storage and placeholder rendering.

    Parameters
    ----------
    credentials_path:
        Path to the JSON file that stores credentials on disk.  Defaults
        to ``~/.sillyhub/daemon/credentials.json``.
    """

    def __init__(self, credentials_path: Path | None = None) -> None:
        self._path = credentials_path or DEFAULT_CREDENTIALS_PATH
        self._credentials: dict[str, str] = {}
        self._load()

    # -- persistence -----------------------------------------------------------

    def _load(self) -> None:
        """Load credentials from the JSON file."""
        if self._path.exists():
            with open(self._path, encoding="utf-8") as f:
                self._credentials = json.load(f)
            logger.debug("credentials_loaded count=%d", len(self._credentials))
        else:
            logger.info("credentials_file_not_found path=%s", self._path)

    def save(self) -> None:
        """Save credentials to file with restricted permissions (0600)."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(self._credentials, f, indent=2)
        try:
            os.chmod(self._path, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            logger.warning("credentials_chmod_failed path=%s", self._path)

    # -- CRUD ------------------------------------------------------------------

    def get(self, key: str) -> str | None:
        """Get a credential value by key."""
        return self._credentials.get(key)

    def set(self, key: str, value: str) -> None:
        """Set a credential value and persist immediately."""
        self._credentials[key] = value
        self.save()

    def remove(self, key: str) -> None:
        """Remove a credential and persist immediately."""
        self._credentials.pop(key, None)
        self.save()

    def list_keys(self) -> list[str]:
        """List all stored credential keys."""
        return list(self._credentials.keys())

    # -- placeholder rendering -------------------------------------------------

    def render_config(self, config: dict) -> dict:
        """Render ``{{USER_*}}`` placeholders in *config*.

        Resolution order for each placeholder:

        1. Local ``credentials.json``
        2. Environment variable of the same name

        If neither source provides a value the placeholder string is
        kept as-is so the caller can detect unresolved entries.
        """
        rendered: dict = {}
        for key, value in config.items():
            if (
                isinstance(value, str)
                and value.startswith("{{USER_")
                and value.endswith("}}")
            ):
                env_var = value[2:-2]  # strip leading {{ and trailing }}
                resolved = self._credentials.get(env_var) or os.environ.get(env_var)
                rendered[key] = resolved if resolved is not None else value
                if resolved is not None:
                    logger.debug(
                        "credential_resolved key=%s source=%s",
                        key,
                        "credentials" if env_var in self._credentials else "env",
                    )
            else:
                rendered[key] = value
        return rendered

    def build_env(self, config: dict) -> dict[str, str]:
        """Build an environment variables dict from rendered config.

        Only entries whose values were successfully resolved (i.e. are
        not still placeholders) are included.  Keys are upper-cased so
        they can be passed directly to ``subprocess.run(env=...)``.
        """
        rendered = self.render_config(config)
        env: dict[str, str] = {}
        for key, value in rendered.items():
            if not (isinstance(value, str) and value.startswith("{{")):
                env[key.upper()] = value
        return env
