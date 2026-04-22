import { useContext } from "react";
import { UserCtx } from "./userContext";

export function useUser() {
  return useContext(UserCtx);
}
