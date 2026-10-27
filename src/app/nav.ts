import type { ViewDef } from './registry';

export interface NavGroupDef {
  id: string;
  title: string;
  /** Position among the places, on the same scale as `ViewDef.order`. */
  order: number;
  /** The group is one tab that opens its own page at `#/<id>` (a section list) instead of a menu. */
  landing?: boolean;
}

/** The groups a view can name in `ViewDef.group`. The shell owns this list so modules stay apart. */
export const NAV_GROUPS: readonly NavGroupDef[] = [
  { id: 'settings', title: 'Settings', order: 80, landing: true },
];

/** Pages that left Settings or never existed in it: Projects & tags is Organize (F-325), Notes and Mirror are the note settings, Shortcuts are in Help. */
const MOVED: Readonly<Record<string, string[]>> = {
  projects: ['organize'],
  'notes-settings': ['note-settings'],
  'note-settings': ['note-settings'],
  mirror: ['note-settings'],
  'shortcuts-settings': ['help', 'shortcuts'],
  shortcuts: ['help', 'shortcuts'],
};

/** The pages Settings had before it became one page (F-326): their content lives on the Settings page itself. */
const FOLDED = new Set(['home', 'general', 'settings', 'spaces', 'sharing', 'security', 'features', 'spaces-settings']);

/**
 * Where an old address now lives, or undefined when the route is current: `#/manage/<x>` and `#/<x>` (`#/devices`, …)
 * become `#/settings/<x>`; the pages Settings folded into one (General, Spaces, Sharing, Security, Features) become `#/settings`;
 * Backups and History are one page, `#/settings/backup`. Pages that left Settings go to their new place (`MOVED`).
 */
export function legacyRoute(route: readonly string[], views: readonly ViewDef[]): string[] | undefined {
  const [first, second, ...rest] = route;
  const moved = (name: string | undefined, bare: boolean): string[] | undefined => (name === 'note-settings' && bare ? undefined : name === undefined || !Object.hasOwn(MOVED, name) ? undefined : MOVED[name]);
  const gone = first === 'manage' || first === 'settings' ? moved(second, false) : moved(first, true);
  if (gone) return gone;
  if (first === 'manage') {
    if (second === 'help') return ['help', ...rest];
    if (second === undefined || FOLDED.has(second)) return ['settings'];
    return ['settings', second === 'backups' || second === 'history' ? 'backup' : second, ...rest];
  }
  if (first === 'settings') return second !== undefined && FOLDED.has(second) ? ['settings'] : undefined;
  // A view that joins another's switch (Reports joins Timer) is reached at `#/<parent>/<path>`; the old address keeps its section.
  const joined = first === undefined ? undefined : views.find((v) => v.joins !== undefined && v.path === first);
  const parent = joined ? views.find((v) => v.id === joined.joins) : undefined;
  if (parent) return [parent.path, first as string, ...route.slice(1)];
  if (first !== undefined && FOLDED.has(first) && first !== 'settings') return ['settings'];
  if (first === 'backups' || first === 'history') return ['settings', 'backup', ...route.slice(1)];
  return views.some((v) => v.group === 'settings' && v.path === first) ? ['settings', ...route] : undefined;
}

type NavPagePlace = { kind: 'page'; id: string; view: ViewDef };
type NavGroupPlace = { kind: 'group'; id: string; title: string; pages: ViewDef[] };
type NavLinkPlace = { kind: 'link'; id: string; title: string; href: string };
type NavPlace = NavPagePlace | NavGroupPlace | NavLinkPlace;

export interface NavModel {
  places: NavPlace[];
  /** The page shown: the route's view, else the first visible one. */
  current: ViewDef | undefined;
  /** The place holding `current`; undefined for a hidden page. */
  activePlace: string | undefined;
}

/**
 * Turns the registered views into what the navigation shows. A view with no (or an unknown) group
 * is a place of its own. A group with one visible page is shown as that page; with none it is left out.
 * A `landing` group is one link to its own page; the route `#/<group>/<page>` makes that page current.
 */
export function navModel(views: readonly ViewDef[], route: readonly string[], groups: readonly NavGroupDef[] = NAV_GROUPS): NavModel {
  const visible = views.filter((v) => !v.hidden && v.joins === undefined);
  const landing = groups.find((g) => g.landing && g.id === route[0]);
  const inLanding = landing ? views.filter((v) => v.group === landing.id) : [];
  const current = landing
    ? (inLanding.find((v) => v.path === route[1] && route[1] !== landing.id) ?? inLanding.find((v) => v.path === landing.id) ?? inLanding.find((v) => !v.hidden) ?? inLanding[0])
    : (views.find((v) => v.path === route[0]) ?? visible[0]);
  const byOrder = (a: ViewDef, b: ViewDef): number => a.order - b.order;
  const known = new Set(groups.map((g) => g.id));
  const ranked: { order: number; place: NavPlace }[] = [];
  for (const v of visible) {
    if (!v.group || !known.has(v.group)) ranked.push({ order: v.order, place: { kind: 'page', id: v.id, view: v } });
  }
  for (const g of groups) {
    const pages = visible.filter((v) => v.group === g.id).sort(byOrder);
    const only = pages[0];
    if (pages.length >= 1 && g.landing) ranked.push({ order: g.order, place: { kind: 'link', id: g.id, title: g.title, href: `#/${g.id}` } });
    else if (pages.length === 1 && only) ranked.push({ order: g.order, place: { kind: 'page', id: only.id, view: only } });
    else if (pages.length > 1) ranked.push({ order: g.order, place: { kind: 'group', id: g.id, title: g.title, pages } });
  }
  ranked.sort((a, b) => a.order - b.order);
  const places = ranked.map((r) => r.place);
  const activePlace = places.find((p) => {
    if (p.kind === 'page') return p.view === current;
    if (p.kind === 'link') return current?.group === p.id;
    return p.pages.includes(current as ViewDef);
  })?.id;
  return { places, current, activePlace };
}
