import "./lib/browser-validation";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AppErrorBoundary } from "./app/AppErrorBoundary";

createRoot(document.getElementById("root")!, {
  // React's default caught-error report can include private response data.
  onCaughtError: () => console.error("Boopity could not render this page."),
}).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
