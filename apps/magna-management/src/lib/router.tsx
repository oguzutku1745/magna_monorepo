import { useCallback, useMemo, useSyncExternalStore } from "react";

const ROUTE_EVENT = "magna-route-change";

export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  window.addEventListener(ROUTE_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(ROUTE_EVENT, callback);
  };
}

function snapshot(): string {
  return window.location.pathname;
}

export function useRoute() {
  const path = useSyncExternalStore(subscribe, snapshot, () => "/");
  const go = useCallback((nextPath: string) => navigate(nextPath), []);
  return useMemo(() => ({ path, go }), [path, go]);
}
