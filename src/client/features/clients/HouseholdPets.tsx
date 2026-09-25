import { Badge } from "../../components/ui/badge";
import { Panel } from "../../components/Panel";
import { Hint } from "../../components/feedback/Hint";
import { PageControls } from "../../components/navigation/PageControls";
import { SearchBox } from "../../components/forms/SearchBox";
import { usePage } from "../../hooks/usePage";
import { speciesLabel } from "./species-label";
import type { Pet } from "./types";

export function HouseholdPets({ revision }: { revision: number }) {
  const page = usePage<{ pets: Pet[] }>("/pets", revision);
  return (
    <Panel
      title="My pets"
      description="Contact your sitter to update pet details."
    >
      <SearchBox
        label="Find a pet"
        initialValue={page.term}
        onSearch={page.search}
      />
      {(page.data?.pets ?? []).map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between rounded-xl border p-4"
        >
          <div>
            <h3 className="font-medium">{p.name}</h3>
            <p className="text-sm text-muted-foreground">
              {speciesLabel(p.species)}
              {p.breed ? ` · ${p.breed}` : ""}
            </p>
          </div>
          <Badge variant="outline">{p.isActive ? "Active" : "Archived"}</Badge>
        </div>
      ))}
      {page.data && !page.data.pets.length && <Hint>No pets found.</Hint>}
      <PageControls
        label="household pets"
        {...page}
        pagination={page.data?.pagination}
      />
    </Panel>
  );
}
