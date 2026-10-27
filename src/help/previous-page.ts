// The page the person was on before opening Help. Started from `index.ts`, so it sees every route
// change even though the Help pages load only when first opened.
let previousPage = '#/';
if (typeof window !== 'undefined') {
  let current = location.hash || '#/';
  window.addEventListener('hashchange', () => {
    if (!current.startsWith('#/help')) previousPage = current;
    current = location.hash || '#/';
  });
}

export const previousPageHash = (): string => previousPage;
