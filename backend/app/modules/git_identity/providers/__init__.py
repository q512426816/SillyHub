"""Provider registry."""

from app.modules.git_identity.providers.base import AccessResult, GitProvider
from app.modules.git_identity.providers.github import GitHubProvider

PROVIDERS: dict[str, GitProvider] = {
    "github": GitHubProvider(),
}

__all__ = ["AccessResult", "GitProvider", "GitHubProvider", "PROVIDERS"]
