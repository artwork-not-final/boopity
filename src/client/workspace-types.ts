// The workspace shell owns busy state, error reporting, and refresh after a mutation.
export type RunWorkspaceAction = (
  work: () => Promise<unknown>,
  message?: string,
) => Promise<void>;
