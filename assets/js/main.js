// Scroll progress indicator.
(() => {
  const bar = document.querySelector(".scroll-progress");
  if (!bar) return;
  const tick = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const pct = max <= 0 ? 0 : (doc.scrollTop / max) * 100;
    bar.style.width = pct + "%";
  };
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      tick();
      ticking = false;
    });
  }, { passive: true });
  tick();
})();

// Heading anchor links (soft, unobtrusive).
(() => {
  const content = document.querySelector(".post__content");
  if (!content) return;
  content.querySelectorAll("h2, h3").forEach((h) => {
    if (!h.id) {
      h.id = h.textContent.trim().toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");
    }
  });
})();
