"use client";

import { useEffect, useState } from "react";

import { WorkspaceAccessGuide } from "@/components/workspace-access-guide";
import { fetchMyBinding } from "@/lib/workspace-binding";

interface Props {
  workspaceId: string;
}

/**
 * Detects whether the current user has a binding for this workspace.
 * Renders the access guide card when no binding exists (FR-001/FR-003).
 * Owner is auto-seeded (task-05) so this only fires for unbound members.
 */
export function WorkspaceBindingGuard({ workspaceId }: Props) {
  const [state, setState] = useState<"loading" | "bound" | "unbound">("loading");

  const check = async () => {
    const binding = await fetchMyBinding(workspaceId);
    setState(binding ? "bound" : "unbound");
  };

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  if (state !== "unbound") return null;
  return <WorkspaceAccessGuide workspaceId={workspaceId} onConfigured={check} />;
}
