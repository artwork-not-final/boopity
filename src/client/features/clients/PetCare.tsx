import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import type { RunWorkspaceAction } from "../../lib/types/workspace-types";
import type { PetDetails } from "./types";
import { PetCareForm } from "./PetCareForm";

export function PetCare({
  id,
  run,
  busy,
  close,
}: {
  id: string;
  run: RunWorkspaceAction;
  busy: boolean;
  close: () => void;
}) {
  const [pet, setPet] = useState<PetDetails | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<{ pet: PetDetails }>(
      `/owner/pets/${id}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setPet(result.pet);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id, retry]);
  if (!pet)
    return (
      <p role={error ? "alert" : "status"} className="text-sm">
        {error || "Loading care details…"}
        {error && (
          <Button
            variant="outline"
            className="ml-3"
            onClick={() => setRetry(retry + 1)}
          >
            Try again
          </Button>
        )}
      </p>
    );
  return <PetCareForm initialPet={pet} run={run} busy={busy} close={close} />;
}
