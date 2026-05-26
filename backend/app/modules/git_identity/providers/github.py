"""GitHub provider — check PAT access via GitHub API."""

from __future__ import annotations

import httpx

from app.modules.git_identity.providers.base import AccessResult, GitProvider


class GitHubProvider(GitProvider):
    """Verify a GitHub PAT can access a repo via ``/repos/{owner}/{repo}`` API."""

    async def check_pat_access(self, token: str, repo_url: str) -> AccessResult:
        owner_repo = self._extract_owner_repo(repo_url)
        if not owner_repo:
            return AccessResult(accessible=False, reason="invalid_repo_url")

        url = f"https://api.github.com/repos/{owner_repo}"
        headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
        }
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=headers)

        if resp.status_code == 200:
            return AccessResult(accessible=True)
        if resp.status_code == 401:
            return AccessResult(accessible=False, reason="auth_failed")
        if resp.status_code == 403:
            return AccessResult(accessible=False, reason="forbidden")
        if resp.status_code == 404:
            return AccessResult(accessible=False, reason="not_found")
        return AccessResult(accessible=False, reason=f"http_{resp.status_code}")

    @staticmethod
    def _extract_owner_repo(repo_url: str) -> str | None:
        """Extract ``owner/repo`` from various GitHub URL formats."""
        url = repo_url.strip().rstrip("/")
        if url.endswith(".git"):
            url = url[:-4]
        # https://github.com/owner/repo
        if "github.com/" in url:
            parts = url.split("github.com/")[-1].split("/")
            if len(parts) >= 2:
                return f"{parts[0]}/{parts[1]}"
        # owner/repo shorthand
        if "/" in url and url.count("/") == 1:
            return url
        return None
