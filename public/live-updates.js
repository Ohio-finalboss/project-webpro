(() => {
  const eventStream = new EventSource('/events');
  let updating = false;
  let updateQueued = false;
  let connectedOnce = false;

  async function refreshRegions() {
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.closest('[data-live-region]') &&
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeElement.tagName)
    ) {
      activeElement.addEventListener('blur', refreshRegions, { once: true });
      return;
    }

    if (updating) {
      updateQueued = true;
      return;
    }

    updating = true;
    try {
      const response = await fetch(window.location.href, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'text/html', 'X-Live-Update': '1' },
      });
      if (!response.ok) return;

      const responseUrl = new URL(response.url);
      const currentUrl = new URL(window.location.href);
      if (responseUrl.pathname !== currentUrl.pathname || responseUrl.search !== currentUrl.search) {
        window.location.assign(responseUrl.href);
        return;
      }

      const html = await response.text();
      const nextDocument = new DOMParser().parseFromString(html, 'text/html');
      const currentRegions = document.querySelectorAll('[data-live-region]');
      let changed = false;

      currentRegions.forEach((currentRegion) => {
        const regionName = currentRegion.dataset.liveRegion;
        const nextRegion = Array.from(nextDocument.querySelectorAll('[data-live-region]'))
          .find((region) => region.dataset.liveRegion === regionName);
        if (nextRegion) {
          currentRegion.replaceWith(nextRegion);
          changed = true;
        }
      });

      if (changed) window.dispatchEvent(new CustomEvent('sse:updated'));
    } catch {
      // EventSource reconnects automatically; keep the current page usable if refresh fails.
    } finally {
      updating = false;
      if (updateQueued) {
        updateQueued = false;
        refreshRegions();
      }
    }
  }

  eventStream.addEventListener('open', () => {
    if (connectedOnce) refreshRegions();
    connectedOnce = true;
  });
  eventStream.addEventListener('shop-update', refreshRegions);
})();
