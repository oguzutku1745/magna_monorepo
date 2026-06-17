import { useCallback, useEffect, useMemo, useState } from "react";

export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("magna-social-route"));
}

export function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    window.addEventListener("magna-social-route", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("magna-social-route", sync);
    };
  }, []);
  const go = useCallback((nextPath: string) => navigate(nextPath), []);
  return useMemo(() => ({ path, go }), [path, go]);
}
