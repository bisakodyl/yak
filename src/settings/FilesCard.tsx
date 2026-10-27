import { useState } from 'preact/hooks';
import { readShrinkPhotos, saveShrinkPhotos } from '../core/blobs/options';

/** Options for files attached to notes. Device-only: the choice is not shared between devices. */
export function FilesCard() {
  const [shrink, setShrink] = useState(readShrinkPhotos());
  return (
    <div class="card st-group">
      <label class="st-check">
        <input
          type="checkbox"
          checked={shrink}
          onChange={(e) => {
            const on = (e.target as HTMLInputElement).checked;
            saveShrinkPhotos(on);
            setShrink(on);
          }}
        />{' '}
        Shrink large photos when I add them
      </label>
      <p class="hint">Off by default: Yak keeps the original file. When on, a PNG, JPEG or WebP over 2560 pixels is re-encoded smaller and only the smaller copy is kept. This loses the original and drops its metadata. This device only.</p>
    </div>
  );
}
