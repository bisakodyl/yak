import type * as Y from 'yjs';

/**
 * Project rates are private (docs/decisions/sync.md, S8): they live in the space's private part, not on
 * the shared project, so an account the space is shared with later never sees them. Keys per field
 * (`<projectId>:rate`, `<projectId>:currency`) with plain values.
 */

const RATES_MAP = 'project_rates';

export interface Rate {
  rate: number | null;
  currency: string;
}

export function ratesMap(privateDoc: Y.Doc): Y.Map<unknown> {
  return privateDoc.getMap<unknown>(RATES_MAP);
}

/** The private rate of a project, or undefined when none was ever set here. */
export function readRate(privateDoc: Y.Doc | undefined, projectId: string): Rate | undefined {
  if (!privateDoc) return undefined;
  const m = ratesMap(privateDoc);
  if (!m.has(`${projectId}:rate`) && !m.has(`${projectId}:currency`)) return undefined;
  const rate = m.get(`${projectId}:rate`);
  const currency = m.get(`${projectId}:currency`);
  return {
    rate: typeof rate === 'number' && Number.isFinite(rate) ? rate : null,
    currency: typeof currency === 'string' && currency ? currency : 'USD',
  };
}

export function writeRate(privateDoc: Y.Doc, projectId: string, patch: Partial<Rate>): void {
  privateDoc.transact(() => {
    if (patch.rate !== undefined) ratesMap(privateDoc).set(`${projectId}:rate`, patch.rate);
    if (patch.currency !== undefined) ratesMap(privateDoc).set(`${projectId}:currency`, patch.currency);
  });
}
