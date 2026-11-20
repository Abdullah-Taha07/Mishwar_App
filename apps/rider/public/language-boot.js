/* Resolve direction before styles and body paint; never execute stored content. */
(() => {
  let language = 'ar';
  try { if (localStorage.getItem('mishwar-language') === 'en') language = 'en'; } catch {}
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl';
})();
