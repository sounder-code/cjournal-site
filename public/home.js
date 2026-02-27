const appConfig = window.APP_CONFIG || {};
const GA_MEASUREMENT_ID = (appConfig.GA_MEASUREMENT_ID || "").trim();

async function loadScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === true) script.setAttribute(key, "");
      else script.setAttribute(key, String(value));
    });
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed: ${src}`));
    document.head.appendChild(script);
  });
}

async function initHomeAnalytics() {
  if (!GA_MEASUREMENT_ID) return;

  await loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`, {
    async: true,
  });

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID, { anonymize_ip: true, send_page_view: false });

  window.gtag("event", "landing_view", {
    page_type: "hub",
    test_id: "hub",
  });

  document.querySelectorAll(".test-link[data-test-id]").forEach((link) => {
    link.addEventListener("click", () => {
      window.gtag("event", "select_test", {
        page_type: "hub",
        test_id: link.dataset.testId || "",
        destination: link.getAttribute("href") || "",
      });
    });
  });
}

initHomeAnalytics().catch(() => {});
