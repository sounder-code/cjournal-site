const env = import.meta.env || {};

window.APP_CONFIG = {
  KAKAO_JS_KEY: (env.VITE_KAKAO_JS_KEY || "8f7002f0d0ac2abb5ac598c9f3f81a36").trim(),
  API_BASE_URL: (env.VITE_API_BASE_URL || "/api").trim(),
  SHARE_IMAGE_URL: (env.VITE_SHARE_IMAGE_URL || "https://kuru.co.kr/og-lizard-002.png").trim(),
  GA_MEASUREMENT_ID: (env.VITE_GA_MEASUREMENT_ID || "G-73FGPYNR28").trim(),
  ADSENSE_CLIENT_ID: (env.VITE_ADSENSE_CLIENT_ID || "ca-pub-3605659204864367").trim(),
  ADSENSE_SLOT_TOP: (env.VITE_ADSENSE_SLOT_TOP || "").trim(),
  ADSENSE_SLOT_RESULT: (env.VITE_ADSENSE_SLOT_RESULT || "").trim(),
  RESULT_IMAGE_MAP: {},
};
