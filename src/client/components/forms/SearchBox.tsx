import { useEffect, useId, useRef, useState } from "react";

import { Input } from "../ui/input";

import { createLiveSearch, showSearchInput } from "../../lib/live-search";

export function SearchBox({
  label,
  onSearch,
  initialValue = "",
  showWhen = true,
  className = "",
}: {
  label: string;
  onSearch: (text: string) => void;
  initialValue?: string;
  showWhen?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(initialValue);
  const [focused, setFocused] = useState(false);
  const callback = useRef(onSearch);
  useEffect(() => {
    callback.current = onSearch;
  }, [onSearch]);
  const [search] = useState(() =>
    createLiveSearch((text) => callback.current(text), initialValue),
  );
  useEffect(() => () => search.cancel(), [search]);
  const id = useId();
  if (!showSearchInput(showWhen, focused, draft)) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="search"
        className="min-h-11 bg-card"
        enterKeyHint="search"
        maxLength={100}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setDraft(e.target.value);
          search.change(e.target.value);
        }}
        onCompositionStart={() => search.startComposition()}
        onCompositionEnd={(e) => search.endComposition(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.nativeEvent.isComposing &&
            e.nativeEvent.keyCode !== 229
          ) {
            e.preventDefault();
            search.flush(e.currentTarget.value);
          }
        }}
      />
    </div>
  );
}
