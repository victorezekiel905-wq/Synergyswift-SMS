"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui";
import { activeHref, type NavGroup, type NavLink } from "@/lib/nav";

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

/**
 * The side menu: pinned pages first, then the areas. Only the area you are in
 * is open; the others show just their name until clicked. People with a short
 * menu (parents, students) see everything open.
 */
export default function SideNav({ groups, path, userKey }: { groups: NavGroup[]; path: string; userKey: string }) {
  const pinKey = `ss-pins:${userKey}`, openKey = `ss-open:${userKey}`;
  const [pins, setPins] = useState<string[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => { setPins(read(pinKey, [])); setOpened(read(openKey, [])); }, [pinKey, openKey]);
  const links = useMemo(() => groups.flatMap(g => g.links), [groups]);
  const current = activeHref(groups, path);
  const currentGroup = groups.find(g => g.links.some(l => l.href === current))?.id;
  const flat = links.length <= 12 || groups.length === 1;
  const isOpen = (id: string) => flat || id === currentGroup || opened.includes(id);
  const toggle = (id: string) => { const n = opened.includes(id) ? opened.filter(x => x !== id) : [...opened, id]; setOpened(n); write(openKey, n); };
  const togglePin = (href: string) => { const n = pins.includes(href) ? pins.filter(x => x !== href) : [...pins, href].slice(-8); setPins(n); write(pinKey, n); };
  const pinned = pins.map(h => links.find(l => l.href === h)).filter(Boolean) as NavLink[];

  const row = (l: NavLink, inPins = false) => {
    const on = l.href === current;
    const isPinned = pins.includes(l.href);
    return (
      <li key={`${inPins ? "p" : ""}${l.href}`} className="group relative">
        <Link href={l.href} aria-current={on ? "page" : undefined} title={l.hint}
          className={"relative block rounded-md py-[7px] pl-3 pr-8 text-[13.5px] leading-5 transition-colors " + (on
            ? "bg-slate-100 font-medium text-slate-900 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-600"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>
          {l.label}
        </Link>
        {!flat && (
          <button type="button" onClick={() => togglePin(l.href)} aria-label={isPinned ? `Unpin ${l.label}` : `Pin ${l.label} to the top`} aria-pressed={isPinned}
            className={"absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 " + (isPinned ? "text-amber-500" : "text-slate-300 opacity-0 hover:text-slate-500 focus:opacity-100 group-hover:opacity-100")}>
            <Icon name="star" className="h-3.5 w-3.5" />
          </button>
        )}
      </li>
    );
  };

  return (
    <nav aria-label="Main" className="space-y-1">
      {pinned.length > 0 && (
        <div className="mb-4">
          <p className="mb-1 px-3 text-xs font-medium text-slate-400">Pinned</p>
          <ul className="space-px">{pinned.map(l => row(l, true))}</ul>
        </div>
      )}
      {groups.map(g => {
        const open = isOpen(g.id);
        return (
          <div key={g.id}>
            {flat ? <p className="mb-1 mt-3 px-3 text-xs font-medium text-slate-400 first:mt-0">{g.title}</p> : (
              <button type="button" onClick={() => toggle(g.id)} aria-expanded={open}
                className={"flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13.5px] font-semibold " + (g.id === currentGroup ? "text-slate-900" : "text-slate-700 hover:bg-slate-50")}>
                <span className="flex-1">{g.title}</span>
                <span className="text-xs font-normal text-slate-400">{g.links.length}</span>
                <Icon name="chevron" className={"h-3.5 w-3.5 text-slate-400 transition-transform " + (open ? "rotate-90" : "")} />
              </button>
            )}
            {open && <ul className={"space-px " + (flat ? "" : "mb-2 ml-2 border-l border-slate-100 pl-1")}>{g.links.map(l => row(l))}</ul>}
          </div>
        );
      })}
      {!flat && <p className="px-3 pt-4 text-[11px] leading-4 text-slate-400">Tip: press Ctrl K to jump to any page. Hover a page and click the star to pin it.</p>}
    </nav>
  );
}

/** Phone bar with the four everyday places and the full menu. */
export function BottomBar({ items, path, onMenu }: { items: { href: string; label: string; icon: string }[]; path: string; onMenu: () => void }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
      {items.map(i => {
        const on = path === i.href || path.startsWith(i.href + "/");
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={"flex flex-col items-center gap-0.5 py-2 text-[11px] " + (on ? "font-semibold text-brand-700" : "text-slate-600")}>
            <Icon name={i.icon as "home"} className="h-5 w-5" />{i.label}
          </Link>
        );
      })}
      <button type="button" onClick={onMenu} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-slate-600"><Icon name="grid" className="h-5 w-5" />Menu</button>
    </nav>
  );
}
