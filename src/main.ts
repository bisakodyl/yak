import './style.css';
import { APP_NAME } from './constants';
import { probes, type ProbeResult, type Status } from './probes';

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';
const DEFAULT_NTFY = 'https://ntfy.sh';
// Input values live outside render() so re-renders do not reset them.
const inputs = { stun: DEFAULT_STUN, ntfy: DEFAULT_NTFY };
const results = new Map<string, ProbeResult>();
/** Results of button-driven tests, kept apart so they never overwrite the passive result. */
const testResults = new Map<string, ProbeResult>();
const labels: Record<Status, string> = { ok: 'OK', warn: 'Check', fail: 'Blocked', info: 'Info', pending: '…' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function render(): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.replaceChildren();
  app.append(el('h1', undefined, `${APP_NAME} capability probe`));
  app.append(
    el('p', 'lede', 'Reports what this browser allows. Nothing is sent anywhere unless you press a test button that says so.'),
  );

  const field = (label: string, key: keyof typeof inputs): void => {
    const row = el('label', 'field', `${label} `);
    const input = el('input');
    input.value = inputs[key];
    input.oninput = () => {
      inputs[key] = input.value;
    };
    row.append(input);
    app.append(row);
  };
  field('STUN server for the network test', 'stun');
  field('ntfy base URL for the signaling test', 'ntfy');

  for (const p of probes) {
    const passive = results.get(p.id) ?? { status: 'pending' as Status, summary: 'Running…' };
    const test = testResults.get(p.id);
    // The test result, once there is one, decides the card's colour; the passive result stays visible.
    const shown = test ?? passive;
    const card = el('section', `card ${shown.status}`);
    const head = el('div', 'head');
    head.append(el('h2', undefined, p.title), el('span', `badge ${shown.status}`, labels[shown.status]));
    card.append(head, el('p', 'summary', passive.summary));
    if (passive.details) {
      const d = el('details');
      d.append(el('summary', undefined, 'Details'), el('pre', undefined, JSON.stringify(passive.details, null, 2)));
      card.append(d);
    }
    if (test) {
      card.append(el('p', 'summary', `Test: ${test.summary}`));
      if (test.details) {
        const d = el('details');
        d.append(el('summary', undefined, 'Test details'), el('pre', undefined, JSON.stringify(test.details, null, 2)));
        card.append(d);
      }
    }
    card.append(el('p', 'why', p.why));
    if (p.action) {
      const a = p.action;
      const btn = el('button', undefined, a.label);
      btn.onclick = async () => {
        btn.disabled = true;
        testResults.set(p.id, { status: 'pending', summary: 'Running…' });
        render();
        let outcome: ProbeResult;
        try {
          outcome = await a.run({ stunUrl: inputs.stun.trim() || DEFAULT_STUN, ntfyUrl: inputs.ntfy.trim() || DEFAULT_NTFY });
        } catch (e) {
          outcome = { status: 'fail', summary: String(e) };
        }
        testResults.set(p.id, outcome);
        render();
      };
      card.append(btn);
    }
    app.append(card);
  }

  const copy = el('button', 'primary', 'Copy report as JSON');
  copy.onclick = async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      url: location.origin,
      results: Object.fromEntries(results),
      tests: Object.fromEntries(testResults),
    };
    const text = JSON.stringify(report, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
    } catch {
      const ta = el('textarea');
      ta.value = text;
      ta.rows = 12;
      app.append(ta);
      ta.select();
    }
  };
  app.append(copy);
}

async function runAll(): Promise<void> {
  render();
  await Promise.all(
    probes.map(async (p) => {
      try {
        results.set(p.id, await p.run());
      } catch (e) {
        results.set(p.id, { status: 'fail', summary: String(e) });
      }
      render();
    }),
  );
}

void runAll();
