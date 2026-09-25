import { ChevronRight, PawPrint } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { speciesLabel } from "./species-label";
import type { Pet } from "./types";

export function PetCards({
  pets,
  busy,
  onSelect,
}: {
  pets: Pet[];
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="grid gap-4 xl:grid-cols-2">
      {pets.map((pet) => (
        <li key={pet.id} className="min-w-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSelect(pet.id)}
            className="group flex h-full w-full items-center gap-4 rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 sm:p-6"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
              <PawPrint aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-lg font-semibold">
                {pet.name}
              </span>
              <span className="mt-1 block break-words text-sm text-muted-foreground">
                {speciesLabel(pet.species)}
                {pet.breed ? ` · ${pet.breed}` : ""}
              </span>
              {!pet.isActive && (
                <Badge variant="outline" className="mt-2">
                  Archived
                </Badge>
              )}
              <span className="mt-3 block text-sm font-medium text-primary">
                Care details
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-5 shrink-0 text-muted-foreground"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
