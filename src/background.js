const AMAZON_PAGE_HOSTS = [
  "amazon.com",
  "amazon.ae",
  "amazon.ca",
  "amazon.cn",
  "amazon.co.jp",
  "amazon.co.uk",
  "amazon.com.au",
  "amazon.com.be",
  "amazon.com.br",
  "amazon.com.mx",
  "amazon.com.tr",
  "amazon.de",
  "amazon.eg",
  "amazon.es",
  "amazon.fr",
  "amazon.in",
  "amazon.it",
  "amazon.nl",
  "amazon.pl",
  "amazon.sa",
  "amazon.se",
  "amazon.sg"
];

const SESSION_KEY = "videoUrlsByTab";
const MAX_URLS_PER_TAB = 40;
const HLS_FILE_RE = /\.hls(?:360|720|1080)?\.m3u8(?:$|[?#])/i;
const LOWER_QUALITY_RE = /\.hls(?:360|720)\.m3u8(?=$|[?#])/i;

let storageQueue = Promise.resolve();

function hostMatches(hostname, root) {
  return hostname === root || hostname.endsWith(`.${root}`);
}

function isAmazonPageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && AMAZON_PAGE_HOSTS.some((root) => hostMatches(url.hostname, root));
  } catch {
    return false;
  }
}

function isAllowedVideoUrl(value) {
  if (typeof value !== "string" || !HLS_FILE_RE.test(value)) return false;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;

    return (
      hostMatches(url.hostname, "media-amazon.com") ||
      hostMatches(url.hostname, "ssl-images-amazon.com") ||
      hostMatches(url.hostname, "images.amazon.com") ||
      AMAZON_PAGE_HOSTS.some((root) => hostMatches(url.hostname, root))
    );
  } catch {
    return false;
  }
}

async function readVideoState() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return result[SESSION_KEY] || {};
}

async function writeVideoState(state) {
  await chrome.storage.session.set({ [SESSION_KEY]: state });
}

function enqueueStorage(task) {
  storageQueue = storageQueue.then(task, task);
  return storageQueue;
}

async function urlExists(url) {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store", credentials: "omit" });
    if (response.ok) return true;
    if (![403, 405].includes(response.status)) return false;
  } catch {
    // Some Amazon media servers reject HEAD. Fall through to a small GET.
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { Range: "bytes=0-0" }
    });
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

async function prefer1080(url) {
  const candidate = url.replace(LOWER_QUALITY_RE, ".hls1080.m3u8");
  if (candidate === url || !isAllowedVideoUrl(candidate)) return url;
  return (await urlExists(candidate)) ? candidate : url;
}

async function recordVideoUrl(tabId, rawUrl) {
  if (tabId < 0 || !isAllowedVideoUrl(rawUrl)) return;
  const url = await prefer1080(rawUrl);

  await enqueueStorage(async () => {
    const state = await readVideoState();
    const current = Array.isArray(state[tabId]) ? state[tabId] : [];
    state[tabId] = [url, ...current.filter((item) => item !== url)].slice(0, MAX_URLS_PER_TAB);
    await writeVideoState(state);
  });

  chrome.runtime.sendMessage({ action: "videoListChanged", tabId }).catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueueStorage(async () => {
    const state = await readVideoState();
    if (!(tabId in state)) return;
    delete state[tabId];
    await writeVideoState(state);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "foundVideoUrl") {
    const tabId = _sender.tab?.id;
    const pageUrl = _sender.tab?.url || _sender.url || "";
    if (Number.isInteger(tabId) && isAmazonPageUrl(pageUrl) && isAllowedVideoUrl(message.url)) {
      void recordVideoUrl(tabId, message.url);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.action === "getVideoUrls") {
    void readVideoState()
      .then((state) => sendResponse({ ok: true, urls: state[message.tabId] || [] }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.action === "clearVideoUrls") {
    void enqueueStorage(async () => {
      const state = await readVideoState();
      delete state[message.tabId];
      await writeVideoState(state);
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
