import { ArrowLeft, PawPrint, Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { PageControls, SearchBox, usePage } from "../Pagination";
import type { RunWorkspaceAction } from "../workspace-types";
import type { Client, Pet } from "./types";
import { NewPetForm } from "./NewPetForm";
import { PetCare } from "./PetCare";
import { PetCards } from "./PetCards";

export function Pets({
  client,
  busy,
  run,
  revision,
  selected,
  onSelect: setSelected,
}: {
  client: Client;
  busy: boolean;
  run: RunWorkspaceAction;
  revision: number;
  selected: string | null;
  onSelect: (pet: string | null) => void;
}) {
  const page = usePage<{ pets: Pet[] }>(
    `/owner/pets?clientId=${encodeURIComponent(client.id)}`,
    revision,
  );
  const pets = page.data?.pets ?? [];
  const canAdd = client.status !== "archived";
  if (selected)
    return (
      <div className="space-y-5">
        <Button
          variant="ghost"
          className="-ml-3 min-h-11"
          disabled={busy}
          onClick={() => setSelected(null)}
        >
          <ArrowLeft aria-hidden="true" /> Back to pets
        </Button>
        {selected === "new" ? (
          <NewPetForm
            clientId={client.id}
            busy={busy}
            run={run}
            close={() => setSelected(null)}
          />
        ) : (
          <PetCare
            key={selected}
            id={selected}
            run={run}
            busy={busy}
            close={() => setSelected(null)}
          />
        )}
      </div>
    );
  return (
    <section aria-label="Client pets" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Pets</h3>
        {canAdd && (
          <Button
            className="min-h-11"
            disabled={busy}
            onClick={() => setSelected("new")}
          >
            <Plus aria-hidden="true" /> Add pet
          </Button>
        )}
      </div>
      <SearchBox
        showWhen={Boolean(pets.length > 4 || page.term || page.offset > 0)}
        className="max-w-md"
        label="Find a pet"
        initialValue={page.term}
        onSearch={page.search}
      />
      {page.loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading pets…
        </p>
      )}
      {page.data && !pets.length && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <PawPrint
            aria-hidden="true"
            className="mx-auto mb-3 size-7 text-muted-foreground"
          />
          <p className="font-medium">
            {page.term ? "No matching pets" : "No pets yet"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {page.term
              ? "Try another name or clear your search."
              : canAdd
                ? "Add this client's first pet to get started."
                : "Reactivate this client to add a pet."}
          </p>
        </div>
      )}
      <PetCards pets={pets} busy={busy} onSelect={setSelected} />
      {(page.error || page.offset > 0 || page.data?.pagination.hasMore) && (
        <PageControls
          label="pets"
          {...page}
          pagination={page.data?.pagination}
        />
      )}
    </section>
  );
}
