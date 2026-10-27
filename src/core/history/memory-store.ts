import type { Mark, NewSegment, Segment, SegmentStore } from './types';

/** A `SegmentStore` in memory: for tests, and the fallback when IndexedDB is unavailable. */
export class MemoryStore implements SegmentStore {
  private readonly logs = new Map<string, Segment[]>();
  private readonly markList: Mark[] = [];
  private next = 1;

  async append(seg: NewSegment): Promise<Segment> {
    const full: Segment = { ...seg, seq: this.next++ };
    const log = this.logs.get(seg.docId) ?? [];
    log.push(full);
    this.logs.set(seg.docId, log);
    return full;
  }

  async list(docId: string): Promise<Segment[]> {
    return [...(this.logs.get(docId) ?? [])];
  }

  async replace(docId: string, seqs: readonly number[], merged: NewSegment): Promise<void> {
    const log = this.logs.get(docId) ?? [];
    const drop = new Set(seqs);
    const first = Math.min(...seqs);
    const out: Segment[] = [];
    let placed = false;
    for (const s of log) {
      if (!drop.has(s.seq)) out.push(s);
      else if (!placed) {
        out.push({ ...merged, seq: first });
        placed = true;
      }
    }
    this.logs.set(docId, out);
  }

  async docIds(): Promise<string[]> {
    return [...this.logs.keys()];
  }

  async addMark(mark: Mark): Promise<void> {
    this.markList.push(mark);
  }

  async marks(docId: string, noteId?: string): Promise<Mark[]> {
    return this.markList.filter((m) => m.docId === docId && (noteId === undefined || m.noteId === noteId)).sort((a, b) => a.at - b.at);
  }

  async removeMark(id: string): Promise<void> {
    const i = this.markList.findIndex((m) => m.id === id);
    if (i >= 0) this.markList.splice(i, 1);
  }

  async removeDoc(docId: string): Promise<void> {
    this.logs.delete(docId);
    for (let i = this.markList.length - 1; i >= 0; i--) if (this.markList[i]?.docId === docId) this.markList.splice(i, 1);
  }
}
