// 旧 gallery-locale 记录每次访问，不能作为手动偏好；此键仅在用户主动切换时写入。
export const LANGUAGE_PREFERENCE_KEY = "gallery-preferred-locale";

// 将固定可信脚本直接输出到根 HTML，在 React 下载前跳转；勿拼入外部输入。
// 顺序为手动偏好、浏览器首个支持语言、英文；保留查询参数和锚点，不覆盖明确语言路径。
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
