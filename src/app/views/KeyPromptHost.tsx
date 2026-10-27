import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { keyPrompt } from '../key-prompt';

type SheetComponent = ComponentType<{ request: NonNullable<typeof keyPrompt.current> }>;

/** Shows the passphrase sheet while an action waits for the account key (`withKey`); its code loads the first time. */
export function KeyPromptHost() {
  const [request, setRequest] = useState(keyPrompt.current);
  const [Sheet, setSheet] = useState<SheetComponent | undefined>();
  useEffect(() => keyPrompt.subscribe(() => setRequest(keyPrompt.current)), []);
  useEffect(() => {
    if (request && !Sheet) void import('./PassphraseSheet').then((m) => setSheet(() => m.PassphraseSheet));
  }, [request, Sheet]);
  return request && Sheet ? <Sheet key={keyPrompt.serial} request={request} /> : null;
}
