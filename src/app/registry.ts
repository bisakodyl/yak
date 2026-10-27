import type { ComponentType } from 'preact';
import { viewHidden } from './features';

export interface ViewProps {
  /** Route segments after the view's own path, for example `#/notes/<id>` gives `['<id>']`. */
  params: string[];
}

export interface ViewDef {
  id: string;
  title: string;
  /** The name in "Go to …" when the title alone is unclear (a Settings page called Notes). */
  commandTitle?: string;
  /** First route segment: `#/<path>`. */
  path: string;
  /** Position in the navigation, lowest first. */
  order: number;
  /** A navigation group the page is listed under (`NAV_GROUPS` in `nav.ts`); omit for a place of its own. */
  group?: string;
  component: ComponentType<ViewProps>;
  /** Hide from the navigation (still routable). */
  hidden?: boolean;
  /**
   * The id of a view this one joins: it is not a tab but a segment of that view's switch, routed at `#/<parent path>/<path>`
   * (Reports joins Timer, R-335). The shell draws the switch, so the two modules never import each other.
   */
  joins?: string;
  /** The segment's label when it differs from `title`. */
  joinLabel?: string;
  /** For a view that other views join: its own segments of the switch (`#/<path>/<id>`), before the joined ones. */
  modes?: readonly { id: string; label: string }[];
}

const views: ViewDef[] = [];

/** Modules call this from their `index.ts`. */
export function registerView(view: ViewDef): void {
  if (views.some((v) => v.id === view.id)) return;
  views.push(view);
  views.sort((a, b) => a.order - b.order);
}

/** The registered views this device shows: the ones its Features page has not hidden (F-309). */
export function allViews(): readonly ViewDef[] {
  return views.filter((v) => !viewHidden(v.id));
}

/** The views this device shows that join `parentId`'s switch, in order. */
export function joinedViews(parentId: string): readonly ViewDef[] {
  return allViews().filter((v) => v.joins === parentId);
}

/** Every registered view, hidden or not: for telling a hidden page from an unknown one. */
export function registeredViews(): readonly ViewDef[] {
  return views;
}

export interface GlobalDef {
  id: string;
  /**
   * Rendered once, above the navigation, whatever view is open, and inside the app context.
   * For background work (bus listeners, timers) and banners that must show on every view.
   */
  component: ComponentType;
}

const globals: GlobalDef[] = [];

export function registerGlobal(def: GlobalDef): void {
  if (globals.some((g) => g.id === def.id)) return;
  globals.push(def);
}

export function allGlobals(): readonly GlobalDef[] {
  return globals;
}

const banners: ComponentType[] = [];

/** A banner shown above the view on every screen (for warnings such as a stale backup). Render nothing when not needed. */
export function registerBanner(component: ComponentType): void {
  if (!banners.includes(component)) banners.push(component);
}

export function allBanners(): readonly ComponentType[] {
  return banners;
}

export interface HeaderItemDef {
  id: string;
  /** Position in the header after the app name, lowest first. */
  order: number;
  /** Rendered in the header on every view, inside the app context. Keep it compact: it must fit a 375 px screen. */
  component: ComponentType;
}

const headerItems: HeaderItemDef[] = [];

/** A compact control in the app header (for example the running timer). */
export function registerHeaderItem(def: HeaderItemDef): void {
  if (headerItems.some((h) => h.id === def.id)) return;
  headerItems.push(def);
  headerItems.sort((a, b) => a.order - b.order);
}

export function allHeaderItems(): readonly HeaderItemDef[] {
  return headerItems;
}
