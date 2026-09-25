export const SEARCH_DELAY_MS = 300;

export function createLiveSearch(
  onSearch: (text: string) => void,
  initialValue = "",
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSearch = initialValue.trim();
  let composing = false;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
  }
  function submit(value: string) {
    const search = value.trim();
    if (search === lastSearch) return;
    lastSearch = search;
    onSearch(search);
  }
  function change(value: string) {
    cancel();
    if (composing || value.trim() === lastSearch) return;
    if (!value.trim()) submit(value);
    else timer = setTimeout(() => submit(value), SEARCH_DELAY_MS);
  }
  return {
    change,
    flush(value: string) {
      cancel();
      if (!composing) submit(value);
    },
    startComposition() {
      composing = true;
      cancel();
    },
    endComposition(value: string) {
      composing = false;
      change(value);
    },
    cancel,
  };
}

export function showSearchInput(
  showWhen: boolean,
  focused: boolean,
  draft: string,
) {
  return showWhen || focused || draft.length > 0;
}
