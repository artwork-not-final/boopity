import { ChevronRight, PawPrint } from "lucide-react";
import { Button } from "../components/ui/button";
import type { ClientSummary } from "./types";

export function ClientList({
  clients,
  busy,
  portalEnabled,
  onSelect,
}: {
  clients: ClientSummary[];
  busy: boolean;
  portalEnabled: boolean;
  onSelect: (id: string, section?: "contact" | "pets") => void;
}) {
  if (!clients.length) return null;
  return (
    <ul aria-label="Clients" className="divide-y border-y">
      {clients.map((client) => {
        const name = `${client.firstName} ${client.lastName}`.trim();
        const status =
          client.status === "archived"
            ? "Archived"
            : client.status === "lead"
              ? "Lead"
              : "Active";
        const portal = !portalEnabled
          ? "Portal disabled"
          : client.status !== "active"
            ? "No portal access"
            : client.members > 0
              ? "Portal access active"
              : client.invitationExpiresAt &&
                  client.invitationExpiresAt > Date.now()
                ? "Invitation pending"
                : "No portal access";
        return (
          <li
            key={client.id}
            className="grid items-center bg-card sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onSelect(client.id)}
              className="grid h-auto min-h-22 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-none px-4 py-4 text-left font-normal whitespace-normal text-foreground hover:bg-muted hover:text-foreground focus-visible:ring-inset dark:hover:bg-muted sm:gap-6 sm:py-5"
            >
              <span className="sr-only">Open client: </span>
              <span className="min-w-0">
                <span className="block break-words text-base font-semibold">
                  {name}
                </span>
                <span className="mt-1 block break-all text-sm text-muted-foreground">
                  {client.email || "No email"}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="max-w-32 text-right text-sm">
                  <span className="block font-medium">{status}</span>
                  <span className="mt-1 block text-muted-foreground">
                    {portal}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onSelect(client.id, "pets")}
              className="mx-4 mb-4 min-h-11 min-w-28 justify-self-start bg-card shadow-none hover:bg-muted hover:text-foreground dark:hover:bg-muted sm:ml-2 sm:mb-0"
            >
              <PawPrint className="size-4" aria-hidden="true" />
              <span className="sr-only">Pets for {name}: </span>
              {client.petCount} {client.petCount === 1 ? "pet" : "pets"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
