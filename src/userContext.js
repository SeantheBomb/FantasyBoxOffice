import { createContext } from "react";

export const UserCtx = createContext({ user: null, loading: true, refresh: () => {} });
