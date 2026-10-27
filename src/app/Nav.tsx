import { useRef, useState } from 'preact/hooks';
import type { NavModel } from './nav';
import type { ViewDef } from './registry';
import { navigate } from './router';
import { IconChevronDown, Menu } from './ui';
import { cx } from './ui/cx';

/** The tab row, at the top on every screen size. */
export function TopNav({ model }: { model: NavModel }) {
  return (
    <nav class="tabs main-tabs" aria-label="Pages">
      {model.places.map((p) =>
        p.kind === 'page' ? (
          <a key={p.id} href={`#/${p.view.path}`} class={p.id === model.activePlace ? 'active' : ''} aria-current={p.id === model.activePlace ? 'page' : undefined}>
            {p.view.title}
          </a>
        ) : p.kind === 'link' ? (
          <a key={p.id} href={p.href} class={p.id === model.activePlace ? 'active' : ''} aria-current={p.id === model.activePlace ? 'page' : undefined}>
            {p.title}
          </a>
        ) : (
          <GroupTab key={p.id} title={p.title} pages={p.pages} current={p.id === model.activePlace ? model.current : undefined} />
        ),
      )}
    </nav>
  );
}

function GroupTab({ title, pages, current }: { title: string; pages: ViewDef[]; current: ViewDef | undefined }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={anchor} class={cx('tab', current && 'active')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {title}
        {current ? <span class="tab-page"> · {current.title}</span> : null} <IconChevronDown />
      </button>
      <Menu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        label={title}
        items={pages.map((v) => ({ label: v.title, onSelect: () => navigate(v.path) }))}
      />
    </>
  );
}
