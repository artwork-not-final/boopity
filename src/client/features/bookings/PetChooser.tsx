import { Button } from "../../components/ui/button";

import { Hint } from "../../components/feedback/Hint";

import { speciesLabel } from "../clients/species-label";
import type { Pet } from "../clients/types";

import { PageControls } from "../../components/navigation/PageControls";
import { SearchBox } from "../../components/forms/SearchBox";
import { usePage } from "../../hooks/usePage";

export function PetChooser({
  path,
  revision,
  selected,
  setSelected,
}: {
  path: string;
  revision: number;
  selected: Pet[];
  setSelected: (pets: Pet[]) => void;
}) {
  const page = usePage<{ pets: Pet[] }>(path, revision);
  const rows = page.data?.pets ?? [];
  const offPage = selected.filter(
    (pet) => !rows.some((row) => row.id === pet.id),
  );
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium">Pets receiving care</legend>
      <SearchBox
        showWhen={Boolean(rows.length > 8 || page.term || page.offset > 0)}
        label="Find a pet for this booking"
        initialValue={page.term}
        onSearch={page.search}
      />
      {offPage.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Selected pets">
          {offPage.map((p) => (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              key={p.id}
              onClick={() =>
                setSelected(selected.filter((row) => row.id !== p.id))
              }
            >
              Remove {p.name}
            </Button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((p) => (
          <label
            key={p.id}
            className={`flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-lg border p-4 text-sm ${selected.some((pet) => pet.id === p.id) ? "border-brand-ink bg-brand-soft" : "bg-card"}`}
          >
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              checked={selected.some((row) => row.id === p.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, p]
                    : selected.filter((row) => row.id !== p.id),
                )
              }
            />
            <span className="min-w-0">
              <span className="block break-words font-medium">{p.name}</span>
              <span className="text-muted-foreground">
                {speciesLabel(p.species)}
              </span>
            </span>
          </label>
        ))}
      </div>
      {page.loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading pets…
        </p>
      )}
      {page.data && !page.data.pets.length && (
        <Hint>No active pets found.</Hint>
      )}
      {(page.error || page.offset > 0 || page.data?.pagination.hasMore) && (
        <PageControls
          label="booking pets"
          {...page}
          pagination={page.data?.pagination}
        />
      )}
    </fieldset>
  );
}
