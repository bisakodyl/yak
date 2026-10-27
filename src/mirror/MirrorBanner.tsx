import { navigate } from '../app/router';
import { Button } from '../app/ui';
import { useMirror, watchFolder } from './runtime';

/** Shown on every screen while the mirror has lost access to its folder. */
export function MirrorBanner() {
  const rt = useMirror();
  const { state, folder, service } = rt;
  if (state.folder.state !== 'prompt' && state.folder.state !== 'denied' && state.folder.state !== 'error') return null;
  return (
    <div class="mirror-banner" role="alert">
      <span>
        The notes mirror stopped: {state.folder.state === 'error' ? state.folder.error : 'access to the folder was lost'}.
      </span>
      {state.folder.state === 'prompt' ? (
        <Button
          onClick={() =>
            void folder.requestAccess().then(async () => {
              await service.refresh();
              await watchFolder(rt);
              await service.run();
            })
          }
        >
          Allow access
        </Button>
      ) : null}
      <Button onClick={() => navigate('mirror')}>Open mirror</Button>
    </div>
  );
}
