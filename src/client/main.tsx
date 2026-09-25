import "./browser-validation";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SelfHostedApp } from "./SelfHostedApp";
import { AppErrorBoundary } from "./AppErrorBoundary";

createRoot(document.getElementById("root")!, {
  // React's default caught-error report can include private response data.
  onCaughtError: () => console.error("Boopity could not render this page."),
}).render(
  <StrictMode>
    <AppErrorBoundary>
      <SelfHostedApp />
    </AppErrorBoundary>
  </StrictMode>,
);
