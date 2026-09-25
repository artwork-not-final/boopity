import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "../ui/button";
import {
  SelectProvider,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { createLiveSearch } from "../../lib/live-search";

export type ChoiceOption = { value: string; label: string; disabled?: boolean };
type Props = Pick<
  ComponentProps<"button">,
  | "id"
  | "aria-label"
  | "aria-describedby"
  | "aria-labelledby"
  | "aria-invalid"
  | "disabled"
> & {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly ChoiceOption[];
  placeholder?: string;
  required?: boolean;
  name?: string;
  searchable?: boolean;
  searchLabel?: string;
  onSearchChange?: (search: string) => void;
  searchValue?: string;
  selectedLabel?: string;
  loading?: boolean;
  footer?: ReactNode;
};
const itemValue = (value: string) => `choice:${value}`;

/** Shared shadcn select/combobox. Native select is hidden and used only for form validation/autofill. */
export function Choice({
  value,
  onValueChange,
  options,
  placeholder = "Choose an option",
  required,
  name,
  searchable,
  searchLabel = "Search options",
  onSearchChange,
  searchValue = "",
  selectedLabel,
  loading,
  footer,
  disabled,
  ...attributes
}: Props) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [invalid, setInvalid] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    searchInput = useRef<HTMLInputElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const generatedId = useId(),
    id = attributes.id ?? generatedId,
    errorId = `${id}-error`,
    listId = `${id}-options`;
  const remoteSearch = useRef(onSearchChange);
  remoteSearch.current = onSearchChange;
  const [liveSearch] = useState(() =>
    createLiveSearch((text) => remoteSearch.current?.(text)),
  );
  useEffect(() => () => liveSearch.cancel(), [liveSearch]);
  useEffect(() => {
    setContainer(
      trigger.current?.closest<HTMLElement>("[data-boopity-theme]") ?? null,
    );
  }, []);
  useEffect(() => {
    setInvalid(false);
  }, [value]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const selected = options.find((option) => option.value === value);
  const waiting =
    loading || Boolean(onSearchChange && query.trim() !== searchValue);
  const label = selectedLabel ?? selected?.label ?? placeholder;
  const canChange = () => !disabled && !trigger.current?.matches(":disabled");
  function choose(next: string) {
    if (
      !canChange() ||
      waiting ||
      !options.some((option) => option.value === next && !option.disabled)
    )
      return;
    onValueChange(next);
    setOpen(false);
  }
  function changeOpen(next: boolean) {
    if (next && !canChange()) return;
    if (next) {
      setQuery("");
      liveSearch.flush("");
    } else liveSearch.cancel();
    setOpen(next);
  }
  const triggerProps = {
    ...attributes,
    id,
    ref: trigger,
    disabled,
    "aria-required": required || undefined,
    "aria-invalid": attributes["aria-invalid"] || invalid || undefined,
    "aria-describedby":
      [attributes["aria-describedby"], invalid ? errorId : ""]
        .filter(Boolean)
        .join(" ") || undefined,
  };
  // Keep a selected remote record valid even when it is not on the search page.
  const formOptions =
    !selected && selectedLabel
      ? [{ value, label: selectedLabel }, ...options]
      : options;
  const formValue = formOptions.some((option) => option.value === value)
    ? value
    : "";
  return (
    <div
      className="relative min-w-0 w-full"
      data-refresh-paused={open ? "true" : undefined}
    >
      <select
        id={`${id}-native`}
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute size-px opacity-0"
        name={name}
        required={required}
        disabled={disabled}
        value={formValue}
        onChange={(event) => choose(event.target.value)}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          trigger.current?.focus();
        }}
      >
        {!formOptions.some((option) => option.value === "") && (
          <option value="">{placeholder}</option>
        )}
        {formOptions.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      {searchable ? (
        <Popover open={open} onOpenChange={changeOpen}>
          <PopoverTrigger asChild>
            <Button
              {...triggerProps}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-haspopup="dialog"
              onKeyDown={(event) => {
                if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                  event.preventDefault();
                  changeOpen(true);
                }
              }}
              className="h-auto min-h-11 w-full min-w-0 justify-between gap-3 border-input bg-card px-3 py-2 text-left text-base font-normal whitespace-normal text-foreground shadow-none hover:bg-card hover:text-foreground md:text-sm"
            >
              <span className="min-w-0 break-words">{label}</span>
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            id={listId}
            aria-label={searchLabel}
            container={container}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchInput.current?.focus();
            }}
          >
            <Command shouldFilter={!onSearchChange} label={searchLabel}>
              <CommandInput
                ref={searchInput}
                aria-label={searchLabel}
                placeholder={searchLabel}
                value={query}
                maxLength={100}
                onValueChange={(text) => {
                  setQuery(text);
                  if (onSearchChange) liveSearch.change(text);
                }}
                onCompositionStart={() => liveSearch.startComposition()}
                onCompositionEnd={(event) =>
                  liveSearch.endComposition(event.currentTarget.value)
                }
              />
              <CommandList aria-busy={waiting}>
                {waiting ? (
                  <p
                    role="status"
                    className="px-3 py-6 text-sm text-muted-foreground"
                  >
                    Loading…
                  </p>
                ) : (
                  <>
                    <CommandEmpty>No matches found.</CommandEmpty>
                    {options.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={itemValue(option.value)}
                        keywords={[option.label]}
                        disabled={option.disabled}
                        onSelect={() => choose(option.value)}
                      >
                        <span className="min-w-0 flex-1 break-words">
                          {option.label}
                        </span>
                        {option.value === value && (
                          <Check
                            className="size-4 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                      </CommandItem>
                    ))}
                  </>
                )}
              </CommandList>
            </Command>
            {footer && (
              <div className="border-t p-3" inert={waiting || undefined}>
                {footer}
              </div>
            )}
          </PopoverContent>
        </Popover>
      ) : (
        <SelectProvider
          open={open}
          onOpenChange={changeOpen}
          value={selected ? itemValue(value) : ""}
          onValueChange={(next) => choose(next.slice(7))}
          disabled={disabled}
        >
          <SelectTrigger {...triggerProps}>
            <SelectValue placeholder={placeholder}>
              <span className="min-w-0 break-words">{label}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent container={container}>
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={itemValue(option.value)}
                disabled={option.disabled}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectProvider>
      )}
      {invalid && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-destructive">
          Choose an option.
        </p>
      )}
    </div>
  );
}
