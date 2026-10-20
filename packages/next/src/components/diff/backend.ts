"use client";

import { createContext, useContext } from "react";

export type PaneId = "a" | "b";

export class StartError extends Error {
  constructor(
    message: string,
    readonly title?: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export interface PaneTarget {
  src: string;
  origin: string;
  /** Browsing-context name for the iframe. Lets a page that is loaded into it find out which pane it is. */
  name?: string;
  release?: () => void;
}

/** Same-origin pages are framed directly; every other origin goes through the local pass-through. */
export interface PaneBackend {
  start(url: string, pane: PaneId, token: string): Promise<PaneTarget>;
}

export const PaneBackendContext = createContext<PaneBackend | null>(null);

export function usePaneBackend(): PaneBackend {
  const backend = useContext(PaneBackendContext);
  if (!backend) throw new Error("diff: a pane was rendered outside a PaneBackendContext provider");
  return backend;
}
