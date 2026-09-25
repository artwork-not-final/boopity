import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Text, Area } from "../../components/forms/TextFields";
import { FormSection } from "../../components/forms/FormSection";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import type { RunWorkspaceAction } from "../../lib/types/workspace-types";
import type { Client, ClientDraft } from "./types";

export function ClientForm({
  client,
  busy,
  run,
  done,
}: {
  client?: Client;
  busy: boolean;
  run: RunWorkspaceAction;
  done: (id: string) => void;
}) {
  const [value, setValue] = useState(
    client ?? {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      address: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      notes: "",
      status: "active",
    },
  );
  const set = (key: keyof ClientDraft, text: string) =>
    setValue((v) => ({ ...v, [key]: text }));
  return (
    <form
      aria-label={client ? "Edit client" : "New client"}
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const { client: saved } = await api<{ client: Client }>(
            client ? `/owner/clients/${client.id}` : "/owner/clients",
            client ? "PUT" : "POST",
            {
              ...value,
              status: value.status === "archived" ? "active" : value.status,
            },
          );
          done(saved.id);
        });
      }}
    >
      <FormSection title="Contact details">
        <div className="grid gap-5 sm:grid-cols-2">
          <Text
            label="First name"
            required
            value={value.firstName}
            onChange={(v) => set("firstName", v)}
            maxLength={100}
          />
          <Text
            label="Last name"
            required
            value={value.lastName}
            onChange={(v) => set("lastName", v)}
            maxLength={100}
          />
          <Text
            label="Client email"
            type="email"
            value={value.email}
            onChange={(v) => set("email", v)}
            maxLength={254}
          />
          <Text
            label="Phone"
            type="tel"
            value={value.phone}
            onChange={(v) => set("phone", v)}
            maxLength={40}
          />
        </div>
        <Text
          label="Address"
          value={value.address}
          onChange={(v) => set("address", v)}
          maxLength={500}
        />
      </FormSection>
      <FormSection title="Emergency contact">
        <div className="grid gap-5 sm:grid-cols-2">
          <Text
            label="Emergency contact"
            value={value.emergencyContactName}
            onChange={(v) => set("emergencyContactName", v)}
            maxLength={200}
          />
          <Text
            label="Emergency phone"
            type="tel"
            value={value.emergencyContactPhone}
            onChange={(v) => set("emergencyContactPhone", v)}
            maxLength={40}
          />
        </div>
      </FormSection>
      <FormSection title="Private notes">
        <Area
          label="Private client notes"
          value={value.notes}
          onChange={(v) => set("notes", v)}
          maxLength={500}
        />
      </FormSection>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button className="min-h-11" disabled={busy}>
          Save client
        </Button>
        {client && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 text-muted-foreground"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  api(
                    `/owner/clients/${client.id}/${client.status === "archived" ? "reactivate" : "archive"}`,
                    "POST",
                    {},
                  ),
                client.status === "archived"
                  ? "Client reactivated. Issue a new invitation for portal access."
                  : "Client archived and portal access revoked.",
              )
            }
          >
            {client.status === "archived"
              ? "Reactivate client"
              : "Archive client"}
          </Button>
        )}
      </div>
    </form>
  );
}
