// LightweightCharts loader with local file first and CDN fallbacks.
(function () {
  const srcs = [
    'lightweight-charts.standalone.production.js',
    'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js',
    'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js',
  ];

  let i = 0;

  function next() {
    if (i >= srcs.length) {
      alert('Chart library failed to load. Check internet.');
      return;
    }

    const s = document.createElement('script');
    s.src = srcs[i++];
    s.onload = () => {
      if (typeof LightweightCharts === 'undefined') next();
    };
    s.onerror = next;
    document.head.appendChild(s);
  }

  next();
})();
