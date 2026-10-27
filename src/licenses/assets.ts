import type { LicenseEntry } from './collect';

/**
 * Bundled data that is not an npm package but needs a credit. Listed when a module of the asset is in
 * the bundle (`match` is found in a bundled module id). Licences here are checked by hand: each needs an
 * owner decision row in docs/decisions/app.md.
 */
export interface BundledAsset {
  match: string;
  entry: LicenseEntry;
}

const CC_BY_3 = `This work is licensed under the Creative Commons Attribution 3.0 United States License.
You are free to share and adapt the work, including for commercial use, if you give appropriate credit,
provide a link to the licence, and indicate if changes were made.
Full text: https://creativecommons.org/licenses/by/3.0/us/legalcode`;

export const BUNDLED_ASSETS: readonly BundledAsset[] = [
  {
    match: 'core/passphrase-words',
    entry: {
      name: 'EFF Large Wordlist for Passphrases',
      version: '2016',
      license: 'CC-BY-3.0',
      author: 'Electronic Frontier Foundation',
      homepage: 'https://www.eff.org/dice',
      text: `EFF Large Wordlist for Passphrases (eff_large_wordlist.txt), https://www.eff.org/dice
Copyright Electronic Frontier Foundation. Used unchanged except that the dice numbers are left out.\n\n${CC_BY_3}`,
      notice: '',
    },
  },
];

/** The credits of the assets whose modules are in the bundle. */
export function bundledAssets(moduleIds: Iterable<string>): LicenseEntry[] {
  const ids = [...moduleIds];
  return BUNDLED_ASSETS.filter((a) => ids.some((id) => id.includes(a.match))).map((a) => a.entry);
}
