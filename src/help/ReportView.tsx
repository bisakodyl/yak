import { useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { Button, Field, toast } from '../app/ui';
import { APP_NAME, FEEDBACK_EMAIL } from '../constants';
import type { LogEntry } from '../sync/event-log';
import { previousPageHash } from './previous-page';
import { buildReport, fileNameFor, lastDay, mailtoUrl, subjectFor } from './report';

declare const __APP_VERSION__: string | undefined;

function deviceText(): string {
  const dpr = window.devicePixelRatio || 1;
  return `${screen.width}x${screen.height} @${dpr}x, ${navigator.language}`;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Help › Report a problem, with exactly what will be sent shown before anything is. */
export function ReportForm() {
  const { sync } = useApp();
  const [what, setWhat] = useState('');
  const [expected, setExpected] = useState('');
  const [details, setDetails] = useState(true);
  const now = new Date();
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development';
  const input = {
    what,
    expected,
    includeDetails: details,
    appName: APP_NAME,
    version,
    userAgent: navigator.userAgent,
    device: deviceText(),
    page: previousPageHash(),
    logText: logText(sync.log.all(), now.getTime()),
    now,
  };
  const report = buildReport(input);
  const copy = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(report);
      return true;
    } catch {
      return false;
    }
  };
  return (
    <>
      <p class="hint">Tell us what went wrong. Nothing is sent until you press a button, and no note or entry contents are included.</p>
      <div class="report-form">
        <Field label="What happened">
          <textarea aria-label="What happened" rows={4} value={what} onInput={(e) => setWhat((e.target as HTMLTextAreaElement).value)} />
        </Field>
        <Field label="What you expected">
          <textarea aria-label="What you expected" rows={2} value={expected} onInput={(e) => setExpected((e.target as HTMLTextAreaElement).value)} />
        </Field>
        <label class="report-check">
          <input type="checkbox" checked={details} onChange={(e) => setDetails((e.target as HTMLInputElement).checked)} />
          <span>Include app version, browser, device, the page I was on and this device's debug log of the last day</span>
        </label>
      </div>
      <h2>This is exactly what will be sent</h2>
      <pre class="log report-preview" aria-label="Report preview" tabIndex={0}>{report}</pre>
      <div class="row report-actions">
        <a
          class="btn primary"
          href={mailtoUrl(FEEDBACK_EMAIL, subjectFor(APP_NAME, what), input)}
          onClick={() => void copy().then((ok) => toast(ok ? 'Full report copied; paste or attach it.' : 'Could not copy; use Download report.'))}
        >
          Email the report
        </a>
        <Button onClick={() => download(fileNameFor(APP_NAME, now), report)}>Download report</Button>
        <Button onClick={() => void copy().then((ok) => toast(ok ? 'Report copied.' : 'Could not copy.'))}>Copy report</Button>
      </div>
      <p class="hint">
        Email goes to {FEEDBACK_EMAIL} from your own mail app. The link holds only the short part; the full report is copied to the clipboard and can be
        downloaded to attach.
      </p>
    </>
  );
}

function logText(entries: readonly LogEntry[], now: number): string {
  return lastDay(entries, now)
    .map((e) => `${new Date(e.at).toISOString()} ${e.kind}${e.detail ? ' ' + e.detail : ''}`)
    .join('\n');
}
