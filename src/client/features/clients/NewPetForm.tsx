import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Choice } from "../../components/forms/Choice";
import { Field } from "../../components/forms/Field";
import { Text } from "../../components/forms/TextFields";
import { FormSection } from "../../components/forms/FormSection";
import { workspaceApi as api } from "../../lib/http/workspace-api";
import type { RunWorkspaceAction } from "../../lib/types/workspace-types";
import { speciesLabel } from "./species-label";

export function NewPetForm({
  clientId,
  busy,
  run,
  close,
}: {
  clientId: string;
  busy: boolean;
  run: RunWorkspaceAction;
  close: () => void;
}) {
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("dog");
  return (
    <form
      aria-label="Add pet"
      className="max-w-2xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api(`/owner/pets/clients/${clientId}`, "POST", {
            name,
            species,
          });
          close();
        }, "Pet added.");
      }}
    >
      <FormSection title="New pet">
        <div className="grid gap-5 sm:grid-cols-2">
          <Text
            label="Pet name"
            value={name}
            onChange={setName}
            required
            maxLength={100}
          />
          <Field label="Species">
            {(id) => (
              <Choice
                id={id}
                disabled={busy}
                value={species}
                onValueChange={setSpecies}
                options={[
                  "dog",
                  "cat",
                  "bird",
                  "rabbit",
                  "reptile",
                  "fish",
                  "other",
                ].map((value) => ({ value, label: speciesLabel(value) }))}
              />
            )}
          </Field>
        </div>
      </FormSection>
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11" disabled={busy}>
          Add pet
        </Button>
        <Button
          className="min-h-11"
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={close}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
