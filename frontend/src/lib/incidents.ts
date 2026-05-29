import { apiFetch } from "./api";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus =
  | "open"
  | "investigating"
  | "mitigated"
  | "resolved";

export interface Incident {
  id: string;
  workspace_id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  description: string | null;
  root_cause: string | null;
  resolution: string | null;
  affected_components: string[];
  reporter_id: string;
  resolved_at: string | null;
  resolved_by: string | null;
  release_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Postmortem {
  id: string;
  incident_id: string;
  timeline: string | null;
  impact: string | null;
  root_cause_analysis: string | null;
  action_items: string[];
  lessons_learned: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
}

export interface CreateIncidentInput {
  title: string;
  severity?: IncidentSeverity;
  description?: string;
  affected_components?: string[];
  release_id?: string;
}

export interface UpdateIncidentInput {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  description?: string;
  root_cause?: string;
  resolution?: string;
  resolved_by?: string;
}

export interface CreatePostmortemInput {
  timeline?: string;
  impact?: string;
  root_cause_analysis?: string;
  action_items?: string[];
  lessons_learned?: string;
}

export function listIncidents(workspaceId: string, status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<Incident[]>(
    `/api/workspaces/${workspaceId}/incidents${qs}`,
  );
}

export function createIncident(
  workspaceId: string,
  input: CreateIncidentInput,
) {
  return apiFetch<Incident>(`/api/workspaces/${workspaceId}/incidents`, {
    method: "POST",
    json: input,
  });
}

export function getIncident(incidentId: string) {
  return apiFetch<Incident>(`/api/incidents/${incidentId}`);
}

export function updateIncident(
  incidentId: string,
  input: UpdateIncidentInput,
) {
  return apiFetch<Incident>(`/api/incidents/${incidentId}`, {
    method: "PATCH",
    json: input,
  });
}

export function createPostmortem(
  incidentId: string,
  input: CreatePostmortemInput,
) {
  return apiFetch<Postmortem>(`/api/incidents/${incidentId}/postmortem`, {
    method: "POST",
    json: input,
  });
}

export function getPostmortem(incidentId: string) {
  return apiFetch<Postmortem>(`/api/incidents/${incidentId}/postmortem`);
}
