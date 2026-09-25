import { useState, useId } from "react";
import { Note } from "./PaymentFields";
import { Button } from "../../components/ui/button";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import type { RunWorkspaceAction as Run } from "../../lib/types/workspace-types";

export function ReverseCredit({
  id,
  run,
  busy,
}: {
  id: string;
  run: Run;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const formId = useId();
  return (
    <div className="text-sm">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={busy}
        aria-expanded={editing}
        aria-controls={formId}
        onClick={() => setEditing((v) => !v)}
      >
        {editing ? "Close correction" : "Correct this booking credit"}
      </Button>
      <form
        id={formId}
        hidden={!editing}
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              api(`/payments/credits/${id}/reverse`, "POST", {
                note,
                confirm: true,
              }),
            "Credit reversed. The amount due was restored; no money moved.",
          );
        }}
      >
        <p>
          Restores the charge without moving money or deleting the original
          record.
        </p>
        <Note
          value={note}
          setValue={setNote}
          required
          label="Private reason for reversing this credit"
        />
        <Button variant="outline" disabled={busy || !note.trim()}>
          Reverse credit and restore charge
        </Button>
      </form>
    </div>
  );
}
