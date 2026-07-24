import { apiFetch } from "./api";
import type { components } from "@/lib/api-types";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/git/schema.py。
export type GitIdentityRead = components["schemas"]["GitIdentityRead"];
export type GitIdentityList = components["schemas"]["GitIdentityList"];
export type GitIdentityCreate = components["schemas"]["GitIdentityCreate"];
export type AccessCheckRequest = components["schemas"]["AccessCheckRequest"];
export type AccessCheckResult = components["schemas"]["AccessCheckResult"];

export function listGitIdentities() {
  return apiFetch<GitIdentityList>("/api/git/identities");
}

export function createGitIdentity(data: GitIdentityCreate) {
  return apiFetch<GitIdentityRead>("/api/git/identities", {
    method: "POST",
    json: data,
  });
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
