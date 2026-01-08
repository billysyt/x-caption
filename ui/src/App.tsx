import { AppShell } from "./components/layout";
import { useAppState } from "./hooks/useAppState";

export function App() {
  const appState = useAppState();
  return <AppShell {...appState} />;
}
