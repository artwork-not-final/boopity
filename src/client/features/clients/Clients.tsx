import { useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Choice } from "../../components/forms/Choice";
import { Field } from "../../components/forms/Field";
import { Hint } from "../../components/feedback/Hint";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import {
  updateWorkspaceLocation,
  useWorkspaceLocation,
} from "../../lib/navigation/workspace-location";
import { compactPage, VISIBLE_PAGE_SIZE } from "../../lib/compact-page";
import { PageControls } from "../../components/navigation/PageControls";
import { SectionTabs } from "../../components/navigation/SectionTabs";
import { SearchBox } from "../../components/forms/SearchBox";
import { usePage } from "../../hooks/usePage";
import type { RunWorkspaceAction } from "../../lib/types/workspace-types";
import type { Client, ClientSummary, ClientInvitation } from "./types";
import { ClientList } from "./ClientList";
import { ClientForm } from "./ClientForm";
import { ClientPortalAccess } from "./ClientPortalAccess";
import { Pets } from "./Pets";

export function Clients({
  revision,
  portalEnabled,
  busy,
  run,
}: {
  revision: number;
  portalEnabled: boolean;
  busy: boolean;
  run: RunWorkspaceAction;
}) {
  const location = useWorkspaceLocation();
  const section = location.clientTab;
  const selected = location.client;
  const [petEditor, setPetEditor] = useState({
    clientId: selected,
    petId: location.pet,
  });
  // Keep this client's editor mounted while its tab is hidden. An explicit
  // pets URL (including the list) takes precedence; another client drops it.
  const selectedPet =
    section === "pets"
      ? location.pet
      : petEditor.clientId === selected
        ? petEditor.petId
        : null;
  useEffect(() => {
    setPetEditor((previous) => {
      const petId =
        section === "pets"
          ? location.pet
          : previous.clientId === selected
            ? previous.petId
            : null;
      return previous.clientId === selected && previous.petId === petId
        ? previous
        : { clientId: selected, petId };
    });
  }, [selected, section, location.pet]);
  const setSection = (clientTab: "contact" | "pets" | "portal") =>
    updateWorkspaceLocation({
      clientTab,
      pet: clientTab === "pets" ? selectedPet : null,
    });
  const setSelected = (client: string | null) =>
    updateWorkspaceLocation({ client, clientTab: "contact", pet: null });
  const [status, setStatus] = useState("all"),
    [invite, setInvite] = useState<ClientInvitation | null>(null);
  const page = usePage<{ clients: ClientSummary[] }>(
    `/owner/clients?status=${status}`,
    revision,
  );
  const [detail, setDetail] = useState<{
    key: string;
    client?: Client;
    error?: string;
  } | null>(null);
  const detailKey = `${selected}:${revision}`;
  // Refresh the saved record without unmounting this client's hidden editors.
  // Never retain a different client's record while its route is loading.
  const current = detail?.client?.id === selected ? detail.client : undefined;
  useEffect(() => {
    if (!selected || selected === "new") return;
    const controller = new AbortController();
    void api<{ client: Client }>(
      `/owner/clients/${encodeURIComponent(selected)}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setDetail({ key: detailKey, client: result.client });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setDetail({ key: detailKey, error: error.message });
      });
    return () => controller.abort();
  }, [detailKey, selected]);
  const clients = page.data?.clients ?? [];
  const pagination = compactPage(page.data?.pagination, clients.length);
  return (
    <div className="space-y-6">
      {!selected && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">Clients &amp; pets</h2>
            <Button
              type="button"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                setSelected("new");
                setInvite(null);
              }}
            >
              <Plus aria-hidden="true" /> Add client
            </Button>
          </div>
          {section === "pets" && (
            <p className="text-sm text-muted-foreground">
              Choose a client to add their pet.
            </p>
          )}
          <div className="grid items-end gap-5 sm:grid-cols-[minmax(0,1fr)_200px]">
            <SearchBox
              label="Search by name, email, or phone"
              onSearch={page.search}
              initialValue={page.term}
            />
            <Field label="Client status">
              {(id) => (
                <Choice
                  id={id}
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value);
                    page.reset();
                  }}
                  options={[
                    ["all", "All clients"],
                    ["active", "Active"],
                    ["lead", "Leads"],
                    ["archived", "Archived"],
                  ].map(([value, label]) => ({ value, label }))}
                />
              )}
            </Field>
          </div>
          <ClientList
            clients={clients.slice(0, VISIBLE_PAGE_SIZE)}
            busy={busy}
            portalEnabled={portalEnabled}
            onSelect={(id, target) => {
              updateWorkspaceLocation({
                client: id,
                clientTab: target ?? section,
                pet: null,
              });
              setInvite(null);
            }}
          />
          {page.data && !clients.length && (
            <Hint>
              {page.term || status !== "all"
                ? "No matching clients."
                : "No clients yet."}
            </Hint>
          )}
          {(page.error ||
            page.loading ||
            page.offset > 0 ||
            pagination?.hasMore) && (
            <PageControls label="clients" {...page} pagination={pagination} />
          )}
        </>
      )}
      <div
        data-refresh-paused={selected ? "true" : undefined}
        className="max-w-5xl space-y-6"
      >
        {selected && (
          <Button
            variant="ghost"
            className="-ml-3 min-h-11"
            disabled={busy}
            onClick={() => {
              setSelected(null);
              setInvite(null);
            }}
          >
            <ArrowLeft aria-hidden="true" />
            Back to clients
          </Button>
        )}
        {current && (
          <header className="flex flex-wrap items-center gap-3">
            <h2 className="min-w-0 break-words text-2xl font-semibold tracking-tight">
              {current.firstName} {current.lastName}
            </h2>
            <Badge variant="outline">
              {current.status === "archived"
                ? "Archived"
                : current.status === "lead"
                  ? "Lead"
                  : "Active"}
            </Badge>
          </header>
        )}
        {selected === "new" && (
          <h2 className="text-2xl font-semibold tracking-tight">New client</h2>
        )}
        {current && (
          <SectionTabs
            label="Client sections"
            items={[
              ["contact", "Contact"],
              ["pets", "Pets"],
              ["portal", "Portal access"],
            ]}
            value={section}
            onValueChange={setSection}
            disabled={busy}
          />
        )}
        {(selected === "new" || current) && (
          <div hidden={section !== "contact"}>
            <ClientForm
              key={selected + (current?.email ?? "")}
              client={current}
              busy={busy}
              run={run}
              done={setSelected}
            />
          </div>
        )}
        {selected && selected !== "new" && !current && (
          <Hint>
            {detail?.key === detailKey && detail.error
              ? detail.error
              : "Loading client details…"}
          </Hint>
        )}
        {current && (
          <>
            <div hidden={section !== "portal"}>
              <ClientPortalAccess
                current={current}
                portalEnabled={portalEnabled}
                busy={busy}
                run={run}
                invite={invite}
                onInvitationChange={setInvite}
              />
            </div>
            <div hidden={section !== "pets"}>
              <Pets
                key={current.id}
                client={current}
                busy={busy}
                run={run}
                revision={revision}
                selected={selectedPet}
                onSelect={(pet) =>
                  updateWorkspaceLocation({ clientTab: "pets", pet })
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
