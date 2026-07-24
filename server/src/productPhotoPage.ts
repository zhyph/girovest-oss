// Placeholder pending Task 5, which owns the real photo-intake page markup
// (mirroring signingPage.ts's getSigningPageHtml). This stub exists only so
// signingApp.ts's static import resolves and the rest of Task 4's routes
// (and signingApp.test.ts's unrelated /sign/:token and
// /product-photos/:token/submit tests) can run without the whole test file
// crashing on module load. Task 5 replaces this file's contents entirely.
export function getProductPhotoPageHtml(_status: 'valid' | 'expired' | 'used' | 'not_found'): string {
  return '<!doctype html><html><body><p>Not implemented yet (Task 5)</p></body></html>'
}
