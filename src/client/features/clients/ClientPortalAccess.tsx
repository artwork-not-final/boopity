import { Button } from "../../components/ui/button";
import { Field } from "../../components/forms/Field";
import { FormSection } from "../../components/forms/FormSection";
import { controlClass } from "../../components/forms/TextFields";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import type { RunWorkspaceAction } from "../../lib/types/workspace-types";
import type { Client, ClientInvitation } from "./types";

export function ClientPortalAccess({
  current,
  portalEnabled,
  busy,
  run,
  invite,
  onInvitationChange,
}: {
  current: Client;
  portalEnabled: boolean;
  busy: boolean;
  run: RunWorkspaceAction;
  invite: ClientInvitation | null;
  onInvitationChange: (invitation: ClientInvitation | null) => void;
}) {
  return (
    <FormSection title="Portal access">
      <p className="text-sm text-muted-foreground">
        Create a private sign-in link to share with this client. It expires in
        seven days and is not emailed automatically. The client must use the
        email saved in their contact details.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={
            busy ||
            !portalEnabled ||
            current.status !== "active" ||
            !current.email
          }
          onClick={() =>
            void run(async () => {
              const response = await api<{ url: string }>(
                `/owner/clients/${current.id}/invitation`,
                "POST",
                {},
              );
              onInvitationChange({ clientId: current.id, url: response.url });
            }, "Invitation created. Share this one-time link privately with the client.")
          }
        >
          Create invitation
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api(`/owner/clients/${current.id}/revoke`, "POST", {});
              onInvitationChange(null);
            }, "Client portal access and invitations revoked.")
          }
        >
          Revoke portal access
        </Button>
      </div>
      {!portalEnabled && (
        <p className="text-sm text-muted-foreground">
          Enable the client portal under Portal & rules to invite clients.
        </p>
      )}
      {invite?.clientId === current.id && (
        <Field
          label="Private one-time invitation link"
          hint="Shown once. Copy and send privately to the client."
        >
          {(id) => (
            <textarea
              id={id}
              readOnly
              rows={3}
              className={controlClass}
              value={invite.url}
              onFocus={(e) => e.target.select()}
            />
          )}
        </Field>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Changing the client's email or archiving them removes their portal
        access. Send a new invitation to restore it.
      </p>
    </FormSection>
  );
}
