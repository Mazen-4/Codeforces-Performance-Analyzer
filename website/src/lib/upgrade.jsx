import { createContext, useContext, useState, useCallback } from "react";

/* The Plus screen is reachable from the nav on every page, and automatically
 * after login on the dashboard. Holding its open state here means one instance
 * of the modal exists, rather than one per page that wants to trigger it. */
const Ctx = createContext({ open: false, show: () => {}, hide: () => {} });

export function UpgradeProvider({ children }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  return (
    <Ctx.Provider value={{ open, show, hide }}>
      {children}
    </Ctx.Provider>
  );
}

export function useUpgrade() {
  return useContext(Ctx);
}
