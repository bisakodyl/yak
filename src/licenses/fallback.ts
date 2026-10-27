const MIT = (copyright: string): string => `MIT License

Copyright (c) ${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

/**
 * Licence text for packages that declare a licence but ship no LICENSE file. The text is the standard
 * one for the declared licence with the copyright line from the package's source header.
 */
export const FALLBACK_TEXT: Readonly<Record<string, { license: string; text: string }>> = {
  // dist/qrcode.mjs: "Copyright (c) 2009 Kazuhiko Arase ... Licensed under the MIT license".
  'qrcode-generator': { license: 'MIT', text: MIT('2009 Kazuhiko Arase') },
};

/** Authors for packages whose package.json names none and whose licence file has no `Copyright (c) <year> <name>` line. */
export const FALLBACK_AUTHOR: Readonly<Record<string, string>> = {
  // https://github.com/cozmo/jsQR: Apache-2.0 boilerplate, no copyright line.
  jsqr: 'Cosmo Wolfe',
};
