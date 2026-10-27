import { isFeatureHidden } from '../features';
import { type SectionPage, sectionsOf } from '../sections';

/** The sections modules registered for a page (`registerSection`), each under its own heading. */
export function Sections({ page }: { page: SectionPage }) {
  return (
    <>
      {sectionsOf(page)
        .filter((s) => !s.feature || !isFeatureHidden(s.feature))
        .map((s) => (
          <section key={s.id} id={`section-${s.id}`} aria-labelledby={`section-${s.id}-h`}>
            <h2 id={`section-${s.id}-h`}>{s.title}</h2>
            <s.component params={[]} />
          </section>
        ))}
    </>
  );
}
