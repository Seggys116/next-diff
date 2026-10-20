"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CornerDownLeft, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { EASE, Kbd } from "./ui";

export interface PaletteItem {
  id: string;
  group: string;
  title: string;
  detail?: string;
  icon?: ReactNode;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

const MAX_RENDERED = 200;

interface Section {
  group: string;
  entries: { item: PaletteItem; index: number }[];
}

/** 0 = title prefix, 1 = title contains, 2 = other match, -1 = no match. */
function rankItem(item: PaletteItem, terms: string[]): number {
  const title = item.title.toLowerCase();
  const haystack = `${item.title} ${item.detail ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  for (const term of terms) {
    if (!haystack.includes(term)) return -1;
  }
  if (terms.length === 0) return 2;
  const whole = terms.join(" ");
  if (title.startsWith(whole) || title.startsWith(terms[0])) return 0;
  if (title.includes(whole) || terms.some((t) => title.includes(t))) return 1;
  return 2;
}

function searchItems(items: PaletteItem[], query: string): PaletteItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  const ranked: { item: PaletteItem; rank: number; order: number }[] = [];
  items.forEach((item, order) => {
    const rank = rankItem(item, terms);
    if (rank >= 0) ranked.push({ item, rank, order });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked.map((r) => r.item);
}

function buildSections(matches: PaletteItem[], groupOrder: string[]): Section[] {
  const capped = matches.slice(0, MAX_RENDERED);
  const byGroup = new Map<string, PaletteItem[]>();
  for (const item of capped) {
    const bucket = byGroup.get(item.group);
    if (bucket) bucket.push(item);
    else byGroup.set(item.group, [item]);
  }
  const names: string[] = [];
  for (const g of groupOrder) {
    if (byGroup.has(g) && !names.includes(g)) names.push(g);
  }
  for (const g of byGroup.keys()) {
    if (!names.includes(g)) names.push(g);
  }
  let index = 0;
  return names.map((group) => ({
    group,
    entries: (byGroup.get(group) ?? []).map((item) => ({ item, index: index++ })),
  }));
}

export function Palette({
  open,
  onClose,
  items,
  groupOrder,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
  groupOrder: string[];
}) {
  // The dialog is mounted only while open, so its state resets on every open.
  return (
    <AnimatePresence>
      {open && (
        <PaletteDialog
          key="palette"
          onClose={onClose}
          items={items}
          groupOrder={groupOrder}
        />
      )}
    </AnimatePresence>
  );
}

function PaletteDialog({
  onClose,
  items,
  groupOrder,
}: {
  onClose: () => void;
  items: PaletteItem[];
  groupOrder: string[];
}) {
  const reduceMotion = useReducedMotion();
  const uid = useId();
  const listId = `${uid}-listbox`;
  const optionId = (index: number) => `${uid}-option-${index}`;

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardNav = useRef(false);

  const sections = useMemo(
    () => buildSections(searchItems(items, query), groupOrder),
    [items, query, groupOrder],
  );
  const flat = useMemo(
    () => sections.flatMap((s) => s.entries.map((e) => e.item)),
    [sections],
  );
  const count = flat.length;
  const active = count === 0 ? -1 : Math.min(activeIndex, count - 1);

  // Focus the input on open and hand focus back to the opener on close.
  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    if (active < 0 || !keyboardNav.current) return;
    keyboardNav.current = false;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, uid]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const moveTo = (index: number) => {
    keyboardNav.current = true;
    setActiveIndex(index);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (count) moveTo(active < 0 ? 0 : (active + 1) % count);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (count) moveTo(active <= 0 ? count - 1 : active - 1);
        break;
      case "Home":
        e.preventDefault();
        if (count) moveTo(0);
        break;
      case "End":
        e.preventDefault();
        if (count) moveTo(count - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (active >= 0) choose(flat[active]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  const panelMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        initial: { opacity: 0, y: 8, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 8, scale: 0.98 },
      };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      onKeyDown={onKeyDown}
    >
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onMouseDown={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        {...panelMotion}
        transition={{ duration: 0.18, ease: EASE }}
        className="relative flex w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <Search aria-hidden className="size-4 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Jump to a change or run an action..."
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {count === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-zinc-500">No matches</p>
          ) : (
            <div id={listId} role="listbox" aria-label="Results">
              {sections.map((section) => (
                <div key={section.group} role="presentation" className="mb-1 last:mb-0">
                  <div
                    role="presentation"
                    className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500"
                  >
                    {section.group}
                  </div>
                  {section.entries.map(({ item, index }) => {
                    const selected = index === active;
                    return (
                      <div
                        key={item.id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => {
                          keyboardNav.current = false;
                          if (index !== activeIndex) setActiveIndex(index);
                        }}
                        onClick={() => choose(item)}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-zinc-100",
                          selected && "bg-white/[0.06]",
                        )}
                      >
                        {item.icon && (
                          <span className="flex shrink-0 items-center text-zinc-400">
                            {item.icon}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                        {item.detail && (
                          <span className="min-w-0 max-w-[40%] truncate text-xs text-zinc-500">
                            {item.detail}
                          </span>
                        )}
                        {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>to move</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>
              <CornerDownLeft aria-hidden className="size-3" />
            </Kbd>
            <span>to run</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            <span>to close</span>
          </span>
        </div>
      </motion.div>
    </div>
  );
}
