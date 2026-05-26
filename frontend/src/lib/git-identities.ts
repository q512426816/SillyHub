import { apiFetch } from "./api";

export type GitIdentityRead = {
  id: string;
  user_id: string;
  provider: string;
  git_username: string | null;
  git_email: string | null;
  credential_type: string;
  key_id: string;
  allowed_repositories: string[];
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

export type GitIdentityList = {
  items: GitIdentityRead[];
  total: number;
};

export type GitIdentityCreate = {
  provider: string;
  credential_type?: string;
  git_username?: string;
  git_email?: string;
  credential: string;
  allowed_repositories?: string[];
  expires_at?: string;
};

export type AccessCheckRequest = {
  identity_id: string;
  repo_url: string;
};

export type AccessCheckResult = {
  identity_id: string;
  repo_url: string;
  accessible: boolean;
  reason: string | null;
};

export function listGitIdentities() {
  return apiFetch<GitIdentityList>("/api/git/identities");
}

export function createGitIdentity(data: GitIdentityCreate) {
  return apiFetch<GitIdentityRead>("/api/git/identities", {
    method: "POST",
    json: data,
  });
}

export function getGitIdentity(identityId: string) {
  return apiFetch<GitIdentityRead>(`/api/git/identities/${identityId}`);
}

export function revokeGitIdentity(identityId: string) {
  return apiFetch<GitIdentityRead>(`/api/git/identities/${identityId}`, {
    method: "DELETE",
  });
}

export function checkGitAccess(data: AccessCheckRequest) {
  return apiFetch<AccessCheckResult>("/api/git/check-access", {
    method: "POST",
    json: data,
  });
}
