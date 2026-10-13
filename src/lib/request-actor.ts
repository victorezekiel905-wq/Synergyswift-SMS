/**
 * Who the server is acting for during this request, so the database change
 * history records the person and not just "the server". Route guards call
 * beginRequest() before their first await, then name the actor once known;
 * the service client sends it in an x-actor header on every query.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Store = { actor: string | null };
const als = new AsyncLocalStorage<Store>();

/** Starts (or reuses) this request's store. Call before the first await of the request's guard. */
export function beginRequest(): Store {
  const s = als.getStore();
  if (s) return s;
  const fresh: Store = { actor: null };
  als.enterWith(fresh);
  return fresh;
}

export function currentActor(): string | null {
  return als.getStore()?.actor ?? null;
}
