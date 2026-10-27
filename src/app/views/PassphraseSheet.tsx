import { useState } from 'preact/hooks';
import { passphraseProblem } from '../../core/passphrase-rules';
import { generatePassphrase } from '../../core/passphrase';
import { errText } from '../../backup/store';
import { useApp } from '../context';
import { NO_ACCOUNT_KEYS, ownerKeys } from '../account-keys-runtime';
import { keyPrompt, type KeyRequest } from '../key-prompt';
import { notePassphraseLength } from '../short-passphrase';
import { Button, Dialog, PassphraseInput, Sheet, SHEET_MEDIA, useMedia } from '../ui';
import { readAccountEncryption } from '../../core/account-encryption';
import { setNewPassphrase, useExistingPassphrase } from '../../backup/set-passphrase';

/**
 * The one passphrase prompt (F-324), opened by `withKey` when an action needs the account key:
 * "Create a passphrase" when the account has none (suggested words, or your own), else
 * "Enter passphrase". Once it is accepted the account key is unlocked and the action runs by itself.
 */
export function PassphraseSheet(props: { request: KeyRequest }) {
  const narrow = useMedia(SHEET_MEDIA);
  const { request } = props;
  const { account } = useApp();
  const close = (): void => keyPrompt.close(false);
  const label = request.kind === 'backup' ? 'Passphrase of the backup' : readAccountEncryption(account) ? 'Enter passphrase' : 'Create a passphrase';
  const body = request.kind === 'backup' ? <BackupPassphrase request={request} /> : <AccountPassphrase request={request} />;
  return narrow ? (
    <Sheet label={label} class="passphrase-sheet" onClose={close}>
      {body}
    </Sheet>
  ) : (
    <Dialog label={label} class="passphrase-sheet" onClose={close}>
      {body}
    </Dialog>
  );
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function BackupPassphrase(props: { request: Extract<KeyRequest, { kind: 'backup' }> }) {
  const [pass, setPass] = useState('');
  const go = (): void => {
    if (pass) props.request.resolve(pass);
    keyPrompt.close(false);
  };
  return (
    <div class="stack" data-passphrase-sheet="backup">
      <h2>Passphrase of the backup</h2>
      <p class="hint">This backup is encrypted. Enter the passphrase it was made with. It is used for this restore only and not stored.</p>
      <label class="row">
        Passphrase <PassphraseInput label="Passphrase of the backup" autocomplete="current-password" value={pass} onInput={setPass} onEnter={go} />
      </label>
      <div class="row">
        <Button variant="primary" disabled={!pass} onClick={go}>
          {capital(props.request.verb)}
        </Button>
      </div>
    </div>
  );
}

function AccountPassphrase(props: { request: Extract<KeyRequest, { kind: 'key' }> }) {
  const { account, accountId } = useApp();
  const { action } = props.request;
  const params = readAccountEncryption(account);
  const [own, setOwn] = useState(false);
  const [words, setWords] = useState(() => generatePassphrase());
  const [typed, setTyped] = useState('');
  const [again, setAgain] = useState('');
  const [written, setWritten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A key already unlocked on this device needs no passphrase: only the action is left (it failed before, or the key got ready meanwhile).
  const ready = !action.fresh && ownerKeys.current.unlocked();
  const pass = params || own ? typed : words;
  const go = (): void => {
    setError('');
    setBusy(true);
    void (async () => {
      if (ownerKeys.current === NO_ACCOUNT_KEYS) throw new Error('This browser cannot keep the keys that sharing needs. Use a current Chrome, Edge, Firefox or Safari.');
      if (!ready) {
        if (params) await useExistingPassphrase(accountId, params, pass);
        else await setNewPassphrase(account, accountId, pass, own ? again : pass);
        notePassphraseLength(pass);
        // Seals the account key with the passphrase and unlocks it; what the action asks of the key waits for this.
        await ownerKeys.current.passphraseTyped(pass);
        if (!ownerKeys.current.unlocked()) throw new Error('The passphrase did not unlock.');
        setTyped('');
        setAgain('');
      }
      await keyPrompt.finish(action);
      keyPrompt.close(true);
    })()
      .catch((e: unknown) => setError(errText(e)))
      .finally(() => setBusy(false));
  };
  const creating = !params && !ready;
  const problem = creating && own && typed ? passphraseProblem(typed) : undefined;
  const canGo = !busy && (ready || (creating ? written && !!pass && (!own || (!problem && typed === again && !!again)) : !!pass));
  return (
    <div class="stack" data-passphrase-sheet={ready ? 'ready' : params ? 'enter' : 'create'}>
      <h2>{ready ? capital(action.verb) : params ? 'Enter passphrase' : 'Create a passphrase'}</h2>
      {ready ? null : params ? (
        <>
          <p class="hint">Your passphrase approves devices and shares. It is asked for again only after 5 idle minutes, and it is never stored.</p>
          <label class="row">
            Passphrase <PassphraseInput label="Passphrase" autocomplete="current-password" value={typed} onInput={setTyped} onEnter={typed ? go : undefined} />
          </label>
        </>
      ) : (
        <>
          <p class="hint">
            It approves devices and shares, and encrypts backups. <strong>If you forget it, nobody can recover it.</strong>
          </p>
          {own ? (
            <div class="stack">
              <label class="row">
                Passphrase <PassphraseInput label="New passphrase" autocomplete="new-password" hint value={typed} onInput={setTyped} />
              </label>
              <label class="row">
                Again <PassphraseInput label="Repeat the passphrase" autocomplete="new-password" value={again} onInput={setAgain} />
              </label>
              <div class="row">
                <Button onClick={() => setOwn(false)}>Use suggested words</Button>
              </div>
            </div>
          ) : (
            <>
              <p>
                <code class="secret" data-suggested-words>
                  {words}
                </code>
              </p>
              <div class="row">
                <Button onClick={() => setWords(generatePassphrase())}>Other words</Button>
                <Button
                  onClick={() => {
                    setOwn(true);
                    setWritten(false);
                  }}
                >
                  Type my own
                </Button>
              </div>
            </>
          )}
          <label class="row">
            <input type="checkbox" checked={written} onChange={(e) => setWritten((e.target as HTMLInputElement).checked)} /> I've written it down
          </label>
        </>
      )}
      <div class="row">
        <Button variant="primary" disabled={!canGo} onClick={go}>
          {ready ? capital(action.verb) : `${creating ? 'Create' : 'Unlock'} and ${action.verb}`}
        </Button>
        <Button onClick={() => keyPrompt.close(false)}>Cancel</Button>
      </div>
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
