import type * as Y from 'yjs';
import { PROJECT_COLORS } from '../app/theme/palette';
import { collection, createRecord } from '../core/schema';
import type { ImportPlan } from './plan';

const ENTRIES_PER_TRANSACTION = 300;

export interface RunOptions {
  deviceId: string;
  signal?: AbortSignal;
  /** Called after each transaction. */
  onProgress?: (done: number, total: number) => void;
  entriesPerTransaction?: number;
  now?: Date;
  /** The space's time document, where entries go. Defaults to the main document (tests). */
  entriesDoc?: Y.Doc;
}

export interface RunResult {
  created: number;
  total: number;
  cancelled: boolean;
  createdClients: number;
  createdProjects: number;
  createdTags: number;
}

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Write a plan into a space document. Clients, projects and tags go first in one transaction,
 * then entries in transactions of a few hundred, with a yield between them so the page stays
 * responsive and the person can cancel. A cancelled run keeps what was written; running the
 * import again with the same file adds only the rest, because every entry carries `import_id`.
 */
export async function runImport(doc: Y.Doc, plan: ImportPlan, options: RunOptions): Promise<RunResult> {
  const stamp = (options.now ?? new Date()).toISOString();
  const per = Math.max(1, options.entriesPerTransaction ?? ENTRIES_PER_TRANSACTION);
  const total = plan.entries.length;
  const result: RunResult = { created: 0, total, cancelled: false, createdClients: 0, createdProjects: 0, createdTags: 0 };

  const clientIds = new Map<string, string>();
  const projectIds = new Map<string, string>();

  doc.transact(() => {
    for (const [key, c] of plan.clients) {
      if (c.existingId) {
        clientIds.set(key, c.existingId);
        continue;
      }
      clientIds.set(key, createRecord(doc, 'clients', { name: c.name, archived: false, created_at: stamp, updated_at: stamp, deleted: false }));
      result.createdClients++;
    }
    let projectCount = collection(doc, 'projects').size;
    for (const [key, p] of plan.projects) {
      if (p.existingId) {
        projectIds.set(key, p.existingId);
        continue;
      }
      projectIds.set(
        key,
        createRecord(doc, 'projects', {
          name: p.name,
          client_id: p.clientKey ? (clientIds.get(p.clientKey) ?? null) : null,
          color: PROJECT_COLORS[projectCount % PROJECT_COLORS.length] ?? PROJECT_COLORS[0],
          billable: false,
          rate: null,
          currency: 'USD',
          active: true,
          created_at: stamp,
          updated_at: stamp,
          deleted: false,
        }),
      );
      projectCount++;
      result.createdProjects++;
    }
    for (const name of plan.newTags) {
      createRecord(doc, 'tags', { name, created_at: stamp, deleted: false });
      result.createdTags++;
    }
  });
  options.onProgress?.(0, total);

  for (let from = 0; from < total; from += per) {
    if (options.signal?.aborted) {
      result.cancelled = true;
      break;
    }
    const chunk = plan.entries.slice(from, from + per);
    const entriesDoc = options.entriesDoc ?? doc;
    entriesDoc.transact(() => {
      for (const e of chunk) {
        createRecord(entriesDoc, 'time_entries', {
          start: e.start,
          stop: e.stop,
          duration: e.duration,
          description: e.description,
          project_id: e.projectKey ? (projectIds.get(e.projectKey) ?? null) : null,
          task_id: null,
          tags: e.tags,
          billable: e.billable,
          device_id: options.deviceId,
          created_at: stamp,
          updated_at: stamp,
          deleted: false,
          import_id: e.importId,
        });
      }
    });
    result.created += chunk.length;
    options.onProgress?.(result.created, total);
    await yieldToBrowser();
  }
  return result;
}
