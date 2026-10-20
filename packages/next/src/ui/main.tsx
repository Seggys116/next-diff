import { LayoutGroup } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { PaneBackendContext } from "@/components/diff/backend";
import { HandoffContext, type DevtoolsOptions, type Environment, type Handoff, type PaneRect } from "@/components/diff/devtools";
import { Workspace } from "@/components/diff/Workspace";
import { createBackend } from "./backend";

interface Boot {
  prefix: string;
  environments: Environment[];
  path: string;
  handoff: boolean;
}

declare global {
  interface Window {
    __DIFF?: Boot;
  }
}

function close(path: string) {
  window.parent.postMessage({ diffDevtools: "close", path }, location.origin);
}

// Report the local slot, hold the entrance until the page has started shrinking, and keep the slot empty until our copy is showing.
function useHandoff(enabled: boolean, ghost: "a" | "b", scrollY: number): Handoff {
  const [entered, setEntered] = useState(!enabled);
  const [landed, setLanded] = useState(!enabled);
  const [live, setLive] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || e.origin !== location.origin) return;
      const type = (e.data as { diffDevtools?: string } | null)?.diffDevtools;
      if (type === "enter") setEntered(true);
      else if (type === "landed") setLanded(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enabled]);

  const onLayout = useCallback((rect: PaneRect, radius: number) => {
    window.parent.postMessage({ diffDevtools: "layout", rect, radius }, location.origin);
  }, []);
  const onGhostDone = useCallback(() => setLive(false), []);

  return useMemo(
    () => ({ entered, landed, scrollY, ghost: live ? ghost : null, slot: enabled ? ghost : null, onLayout: enabled ? onLayout : undefined, onGhostDone }),
    [entered, landed, scrollY, live, enabled, ghost, onLayout, onGhostDone],
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid h-dvh place-items-center bg-[#08080a] p-6 text-zinc-100">
      <div className="max-w-md text-center">
        <h1 className="text-[15px] font-semibold">{title}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{body}</p>
        <button
          type="button"
          onClick={() => close("")}
          className="mt-5 inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium outline-none transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/30"
        >
          Back to the site
        </button>
      </div>
    </div>
  );
}

function App({ boot }: { boot: Boot }) {
  const backend = useMemo(() => createBackend(boot.prefix), [boot.prefix]);
  const opened = useMemo(() => {
    const q = new URLSearchParams(location.search);
    const num = (k: string) => {
      const n = Number(q.get(k));
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    };
    const w = num("vw");
    const h = num("vh");
    return { window: boot.handoff && w >= 280 && w <= 3840 && h >= 200 && h <= 3000 ? { w, h } : undefined, scrollY: boot.handoff ? num("sy") : 0 };
  }, [boot.handoff]);
  // Your local site is the right-hand pane (B), so that is the slot your page shrinks into.
  const handoff = useHandoff(boot.handoff, "b", opened.scrollY);

  const environments = useMemo<Environment[]>(
    () => [...boot.environments, { id: "local", label: "Local", origin: location.origin, hint: `Your dev server · ${location.host}` }],
    [boot.environments],
  );
  const devtools = useMemo<DevtoolsOptions>(() => ({ environments, onClose: close, window: opened.window }), [environments, opened.window]);

  const remote = environments.find((e) => e.id !== "local");
  if (!remote) {
    return (
      <Message
        title="No site to compare against"
        body="Pass the live origin to withDiff in next.config: withDiff(nextConfig, { live: 'https://your-site.com' })."
      />
    );
  }

  // Live (or dev) on the left as the baseline, your local site on the right as the change.
  const local = environments[environments.length - 1];
  const urlA = remote.origin + boot.path;
  const urlB = local.origin + boot.path;

  return (
    <PaneBackendContext.Provider value={backend}>
      <HandoffContext.Provider value={handoff}>
        <LayoutGroup>
          <Workspace urlA={urlA} urlB={urlB} devtools={devtools} />
        </LayoutGroup>
      </HandoffContext.Provider>
    </PaneBackendContext.Provider>
  );
}

const boot = window.__DIFF;
const mount = document.getElementById("root");
if (mount && boot) createRoot(mount).render(<App boot={boot} />);
