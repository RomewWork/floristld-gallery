// Separate from the legacy gallery-locale key, which recorded every visited URL.
export const LANGUAGE_PREFERENCE_KEY = "gallery-preferred-locale";

// Static, trusted source emitted directly in the root HTML. No React download is needed.
export const localeEntryScript = `(() => {
  if (window.location.pathname !== '/') return;
  let locale;
  try { locale = localStorage.getItem(${JSON.stringify(LANGUAGE_PREFERENCE_KEY)}); } catch {}
  if (locale !== 'zh' && locale !== 'en') {
    const languages = navigator.languages && navigator.languages.length
      ? navigator.languages : [navigator.language || ''];
    locale = languages.map(language => language.toLowerCase().split('-')[0])
      .find(language => language === 'zh' || language === 'en') || 'en';
  }
  window.location.replace('/' + locale + '/' + window.location.search + window.location.hash);
})();`;
