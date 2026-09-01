const PRODUCT_IMAGE_PATH_RE = /\/images\/I\//i;
const IMAGE_EXTENSION_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
const AMAZON_IMAGE_ROOTS = ["media-amazon.com", "ssl-images-amazon.com", "images.amazon.com"];
const HLS_FILE_RE = /\.hls(?:360|720|1080)?\.m3u8(?:$|[?#])/i;
const reportedVideoUrls = new Set();

function hostMatches(hostname, root) {
  return hostname === root || hostname.endsWith(`.${root}`);
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function reportVideoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return;

  try {
    const url = new URL(rawUrl, location.href).href;
    if (!HLS_FILE_RE.test(url) || reportedVideoUrls.has(url)) return;
    reportedVideoUrls.add(url);
    chrome.runtime.sendMessage({ action: "foundVideoUrl", url }).catch(() => {});
  } catch {
    // Ignore malformed media URLs from page markup.
  }
}

function inspectMediaNode(node) {
  if (!node || node.nodeType !== 1) return;

  if (node.matches?.("video, source")) reportVideoUrl(node.currentSrc || node.src || node.getAttribute("src"));
  for (const media of node.querySelectorAll?.("video, source") || []) {
    reportVideoUrl(media.currentSrc || media.src || media.getAttribute("src"));
  }
}

function installVideoDiscovery() {
  if (typeof performance !== "undefined") {
    for (const entry of performance.getEntriesByType?.("resource") || []) reportVideoUrl(entry.name);
  }

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) reportVideoUrl(entry.name);
      });
      observer.observe({ type: "resource", buffered: true });
    } catch {
      // Older Chromium builds may not support buffered resource observation.
    }
  }

  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") inspectMediaNode(record.target);
        for (const node of record.addedNodes || []) inspectMediaNode(node);
      }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  }
}

function normalizeProductImageUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  try {
    const decoded = decodeHtmlEntities(rawUrl.replace(/\\u0026/g, "&").replace(/\\\//g, "/"));
    const url = new URL(decoded, location.href);
    if (url.protocol !== "https:") return null;
    if (!AMAZON_IMAGE_ROOTS.some((root) => hostMatches(url.hostname, root))) return null;
    if (!PRODUCT_IMAGE_PATH_RE.test(url.pathname) || !IMAGE_EXTENSION_RE.test(url.pathname)) return null;

    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\._[^/]+_\.(avif|gif|jpe?g|png|webp)$/i, ".$1");
    return url.href;
  } catch {
    return null;
  }
}

function candidateUrlsFromElement(element) {
  const candidates = [];
  const attributes = ["data-old-hires", "data-a-hires", "data-src", "src"];

  for (const attribute of attributes) {
    const value = element.getAttribute(attribute);
    if (value) candidates.push(value);
  }

  const srcset = element.getAttribute("srcset");
  if (srcset) {
    for (const entry of srcset.split(",")) {
      const value = entry.trim().split(/\s+/)[0];
      if (value) candidates.push(value);
    }
  }

  const dynamicImages = element.getAttribute("data-a-dynamic-image");
  if (dynamicImages) {
    try {
      candidates.push(...Object.keys(JSON.parse(dynamicImages)));
    } catch {
      // Ignore malformed page metadata and retain the normal image attributes.
    }
  }

  return candidates;
}

function getProductTitle() {
  const title = document.querySelector("#productTitle")?.textContent?.trim();
  return title || document.querySelector("meta[property='og:title']")?.content?.trim() || document.title;
}

function getAsin() {
  const hiddenAsin = document.querySelector("#ASIN")?.value?.trim();
  if (/^[A-Z0-9]{10}$/i.test(hiddenAsin || "")) return hiddenAsin.toUpperCase();

  const urlMatch = location.pathname.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  if (urlMatch) return urlMatch[1].toUpperCase();

  const selected = document.querySelector("[data-asin].swatchSelect, [data-asin][aria-checked='true']")?.dataset?.asin;
  if (/^[A-Z0-9]{10}$/i.test(selected || "")) return selected.toUpperCase();
  return "UNKNOWN-ASIN";
}

function collectProductImages() {
  const ordered = new Map();

  function add(rawUrl, source) {
    const normalized = normalizeProductImageUrl(rawUrl);
    if (!normalized || ordered.has(normalized)) return;
    ordered.set(normalized, { url: normalized, originalUrl: rawUrl, source });
  }

  const mainSelectors = ["#landingImage", "#imgBlkFront", "#ebooksImgBlkFront", "#main-image"];
  for (const selector of mainSelectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    for (const candidate of candidateUrlsFromElement(element)) add(candidate, "主图");
  }

  const gallerySelectors = [
    "#altImages li:not(.videoThumbnail) img",
    "#imageBlock img",
    "#main-image-container img",
    "#imageBlock_feature_div img",
    "#ebooksImageBlockContainer img"
  ];

  for (const selector of gallerySelectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (element.closest(".videoThumbnail, .vse-video-item, [data-video-url]")) continue;
      for (const candidate of candidateUrlsFromElement(element)) add(candidate, "商品图");
    }
  }

  // Some layouts keep the high-resolution gallery only in ImageBlock metadata.
  if (ordered.size < 2) {
    const metadataScripts = [...document.querySelectorAll("script")].filter((script) =>
      /ImageBlock|colorImages|hiRes/.test(script.textContent || "")
    );
    const metadataUrlRe = /["'](?:hiRes|large|mainUrl)["']\s*:\s*["'](https:[^"']+)["']/g;

    for (const script of metadataScripts.slice(0, 8)) {
      let match;
      while ((match = metadataUrlRe.exec(script.textContent || "")) && ordered.size < 40) {
        add(match[1], "页面高清图");
      }
    }
  }

  return [...ordered.values()].slice(0, 40);
}

function scanProduct() {
  const images = collectProductImages();
  return {
    ok: true,
    asin: getAsin(),
    title: getProductTitle(),
    pageUrl: location.href,
    images
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== "scanProductImages") return false;

  try {
    sendResponse(scanProduct());
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
  return false;
});

installVideoDiscovery();
