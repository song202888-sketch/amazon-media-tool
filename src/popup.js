import { strToU8, zipSync } from "fflate";
import muxjs from "mux.js";

const state = {
  tabId: null,
  product: null,
  selectedImages: new Set(),
  videoUrls: [],
  busy: false
};

const elements = {
  pageSummary: document.querySelector("#page-summary"),
  imageCount: document.querySelector("#image-count"),
  imageGrid: document.querySelector("#image-grid"),
  imageEmpty: document.querySelector("#image-empty"),
  selectAll: document.querySelector("#select-all"),
  selectNone: document.querySelector("#select-none"),
  refreshImages: document.querySelector("#refresh-images"),
  downloadZip: document.querySelector("#download-zip"),
  videoCount: document.querySelector("#video-count"),
  videoList: document.querySelector("#video-list"),
  videoEmpty: document.querySelector("#video-empty"),
  refreshVideos: document.querySelector("#refresh-videos"),
  clearVideos: document.querySelector("#clear-videos"),
  progressPanel: document.querySelector("#progress-panel"),
  progressTitle: document.querySelector("#progress-title"),
  progressBar: document.querySelector("#progress-bar"),
  progressDetail: document.querySelector("#progress-detail"),
  toast: document.querySelector("#toast")
};

function sanitizeFilename(value, fallback = "Amazon商品") {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function showToast(message, type = "info") {
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

function setProgress(title, percent, detail = "") {
  elements.progressPanel.hidden = false;
  elements.progressTitle.textContent = title;
  elements.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  elements.progressDetail.textContent = detail;
}

function hideProgress() {
  elements.progressPanel.hidden = true;
  elements.progressBar.style.width = "0%";
}

function setBusy(busy) {
  state.busy = busy;
  for (const button of document.querySelectorAll("button")) button.disabled = busy;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("未找到当前标签页");
  state.tabId = tab.id;
  return tab;
}

async function sendToTab(message) {
  try {
    return await chrome.tabs.sendMessage(state.tabId, message);
  } catch {
    throw new Error("请先打开 Amazon 商品详情页，并刷新一次页面");
  }
}

function renderPageSummary() {
  if (!state.product) {
    elements.pageSummary.textContent = "等待识别 Amazon 商品页";
    return;
  }

  const asin = state.product.asin === "UNKNOWN-ASIN" ? "未识别 ASIN" : state.product.asin;
  elements.pageSummary.textContent = `${asin} · ${state.product.title}`;
}

function renderImages() {
  const images = state.product?.images || [];
  elements.imageGrid.replaceChildren();
  elements.imageCount.textContent = `${images.length} 张`;
  elements.imageEmpty.hidden = images.length > 0;

  images.forEach((image, index) => {
    const label = document.createElement("label");
    label.className = "image-card";
    label.title = image.url;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedImages.has(image.url);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedImages.add(image.url);
      else state.selectedImages.delete(image.url);
      updateImageDownloadButton();
    });

    const preview = document.createElement("img");
    preview.src = image.url;
    preview.alt = `商品图 ${index + 1}`;
    preview.loading = "lazy";

    const badge = document.createElement("span");
    badge.textContent = String(index + 1).padStart(2, "0");

    label.append(checkbox, preview, badge);
    elements.imageGrid.append(label);
  });

  updateImageDownloadButton();
}

function updateImageDownloadButton() {
  const count = state.selectedImages.size;
  elements.downloadZip.textContent = count ? `整套打包 ZIP（${count} 张）` : "整套打包 ZIP";
  elements.downloadZip.disabled = state.busy || count === 0;
}

function qualityLabel(url, index) {
  const match = url.match(/\.hls(360|720|1080)?\.m3u8/i);
  return match?.[1] ? `${match[1]}P` : `视频 ${index + 1}`;
}

function renderVideos() {
  elements.videoList.replaceChildren();
  elements.videoCount.textContent = `${state.videoUrls.length} 个`;
  elements.videoEmpty.hidden = state.videoUrls.length > 0;

  state.videoUrls.forEach((url, index) => {
    const row = document.createElement("div");
    row.className = "video-row";

    const text = document.createElement("div");
    text.className = "video-text";
    const title = document.createElement("strong");
    title.textContent = qualityLabel(url, index);
    const address = document.createElement("span");
    address.textContent = new URL(url).hostname;
    text.append(title, address);

    const button = document.createElement("button");
    button.className = "secondary compact";
    button.textContent = "下载 MP4";
    button.addEventListener("click", () => downloadVideo(url, index));

    row.append(text, button);
    elements.videoList.append(row);
  });
}

async function scanImages() {
  const response = await sendToTab({ action: "scanProductImages" });
  if (!response?.ok) throw new Error(response?.error || "商品图识别失败");

  state.product = response;
  state.selectedImages = new Set(response.images.map((image) => image.url));
  renderPageSummary();
  renderImages();
}

async function loadVideos() {
  const response = await chrome.runtime.sendMessage({ action: "getVideoUrls", tabId: state.tabId });
  if (!response?.ok) throw new Error(response?.error || "视频列表读取失败");
  state.videoUrls = response.urls || [];
  renderVideos();
}

function imageExtension(contentType, url) {
  const mime = (contentType || "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("avif")) return "avif";
  if (mime.includes("gif")) return "gif";
  const match = new URL(url).pathname.match(/\.(avif|gif|jpe?g|png|webp)$/i);
  return match?.[1]?.toLowerCase().replace("jpeg", "jpg") || "jpg";
}

async function fetchWithFallback(image) {
  const attempts = [...new Set([image.url, image.originalUrl].filter(Boolean))];
  let lastError;

  for (const url of attempts) {
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error("空文件");
      return { blob, url, contentType: response.headers.get("content-type") || blob.type };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("图片下载失败");
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function triggerBlobDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url: objectUrl, filename, saveAs: false, conflictAction: "uniquify" });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

async function downloadImagesAsZip() {
  if (state.busy || !state.product) return;
  const selected = state.product.images.filter((image) => state.selectedImages.has(image.url));
  if (!selected.length) return;

  setBusy(true);
  const failures = [];
  let completed = 0;

  try {
    const folderName = sanitizeFilename(`${state.product.asin}_${state.product.title}`);
    const zipEntries = {};

    const results = await mapWithConcurrency(selected, 4, async (image, index) => {
      try {
        const result = await fetchWithFallback(image);
        completed += 1;
        setProgress("正在获取高清商品图", (completed / selected.length) * 72, `${completed} / ${selected.length}`);
        return { ok: true, index, image, ...result };
      } catch (error) {
        completed += 1;
        failures.push(`${String(index + 1).padStart(2, "0")}: ${image.url} (${error.message})`);
        setProgress("正在获取高清商品图", (completed / selected.length) * 72, `${completed} / ${selected.length}`);
        return { ok: false, index };
      }
    });

    for (const result of results) {
      if (!result.ok) continue;
      const extension = imageExtension(result.contentType, result.url);
      zipEntries[`${folderName}/${String(result.index + 1).padStart(2, "0")}.${extension}`] =
        new Uint8Array(await result.blob.arrayBuffer());
    }

    if (!results.some((result) => result.ok)) throw new Error("所有图片均下载失败");

    const notes = [
      `商品：${state.product.title}`,
      `ASIN：${state.product.asin}`,
      `来源：${state.product.pageUrl}`,
      `导出时间：${new Date().toLocaleString()}`,
      `成功：${results.filter((result) => result.ok).length} 张`,
      `失败：${failures.length} 张`
    ];
    if (failures.length) notes.push("", "失败明细：", ...failures);
    zipEntries[`${folderName}/下载说明.txt`] = strToU8(notes.join("\n"));

    setProgress("正在生成 ZIP", 74, "压缩高清图片");
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const archive = zipSync(zipEntries, { level: 6 });
    const blob = new Blob([archive], { type: "application/zip" });

    const filename = `${folderName}_商品图.zip`;
    await triggerBlobDownload(blob, filename);
    setProgress("下载已开始", 100, filename);
    showToast(`已打包 ${results.filter((result) => result.ok).length} 张高清图`, "success");
    window.setTimeout(hideProgress, 1800);
  } catch (error) {
    hideProgress();
    showToast(error.message, "error");
  } finally {
    setBusy(false);
    updateImageDownloadButton();
  }
}

function resolveUrl(base, value) {
  return new URL(value, base).href;
}

function parseAttributeList(line) {
  const attributes = {};
  const body = line.slice(line.indexOf(":") + 1);
  for (const match of body.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi)) {
    attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
  }
  return attributes;
}

function chooseBestVariant(playlistText, playlistUrl) {
  const lines = playlistText.split(/\r?\n/).map((line) => line.trim());
  const variants = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("#EXT-X-STREAM-INF:")) continue;
    const attributes = parseAttributeList(lines[index]);
    const nextLine = lines.slice(index + 1).find((line) => line && !line.startsWith("#"));
    if (!nextLine) continue;
    const resolution = attributes.RESOLUTION?.match(/(\d+)x(\d+)/i);
    variants.push({
      url: resolveUrl(playlistUrl, nextLine),
      pixels: resolution ? Number(resolution[1]) * Number(resolution[2]) : 0,
      bandwidth: Number(attributes.BANDWIDTH || 0)
    });
  }

  variants.sort((a, b) => b.pixels - a.pixels || b.bandwidth - a.bandwidth);
  return variants[0]?.url || null;
}

async function fetchText(url, label) {
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
  return response.text();
}

async function downloadVideo(masterUrl, videoIndex) {
  if (state.busy) return;
  setBusy(true);

  try {
    setProgress("正在读取视频清单", 3, "解析最高画质");
    let playlistUrl = masterUrl;
    let playlistText = await fetchText(masterUrl, "主播放列表读取");
    const variantUrl = chooseBestVariant(playlistText, masterUrl);
    if (variantUrl) {
      playlistUrl = variantUrl;
      playlistText = await fetchText(variantUrl, "高清播放列表读取");
    }

    if (/#EXT-X-KEY:.*METHOD=(?!NONE)/i.test(playlistText)) {
      throw new Error("该视频使用 HLS 加密，当前版本不会绕过加密");
    }
    if (/#EXT-X-MAP:/i.test(playlistText)) {
      throw new Error("该视频使用 fMP4 分片，当前版本暂不支持转换");
    }

    const segmentUrls = playlistText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => resolveUrl(playlistUrl, line));

    if (!segmentUrls.length) throw new Error("播放列表中没有找到视频分片");

    const transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: true });
    let initSegment = null;
    const mediaSegments = [];

    transmuxer.on("data", (segment) => {
      if (!initSegment && segment.initSegment?.byteLength) {
        initSegment = new Uint8Array(segment.initSegment);
      }
      if (segment.data?.byteLength) mediaSegments.push(new Uint8Array(segment.data));
    });

    for (let index = 0; index < segmentUrls.length; index += 1) {
      let response;
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          response = await fetch(segmentUrls[index], { cache: "no-store", credentials: "omit" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          break;
        } catch (error) {
          lastError = error;
          if (attempt === 3) throw new Error(`第 ${index + 1} 个视频分片失败：${lastError.message}`);
        }
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength) throw new Error(`第 ${index + 1} 个视频分片为空`);
      transmuxer.push(bytes);
      transmuxer.flush();
      setProgress("正在下载并转换视频", 8 + ((index + 1) / segmentUrls.length) * 86, `${index + 1} / ${segmentUrls.length}`);
    }

    if (!initSegment || !mediaSegments.length) throw new Error("视频转换没有生成有效 MP4 数据");

    const blob = new Blob([initSegment, ...mediaSegments], { type: "video/mp4" });
    const productPrefix = state.product
      ? `${state.product.asin}_${sanitizeFilename(state.product.title, "Amazon视频")}`
      : "Amazon视频";
    const filename = `${sanitizeFilename(productPrefix)}_${String(videoIndex + 1).padStart(2, "0")}.mp4`;
    await triggerBlobDownload(blob, filename);
    setProgress("下载已开始", 100, filename);
    showToast("MP4 已生成并开始下载", "success");
    window.setTimeout(hideProgress, 1800);
  } catch (error) {
    hideProgress();
    showToast(error.message, "error");
  } finally {
    setBusy(false);
    updateImageDownloadButton();
  }
}

elements.selectAll.addEventListener("click", () => {
  state.selectedImages = new Set((state.product?.images || []).map((image) => image.url));
  renderImages();
});

elements.selectNone.addEventListener("click", () => {
  state.selectedImages.clear();
  renderImages();
});

elements.refreshImages.addEventListener("click", async () => {
  try {
    await scanImages();
    showToast("商品图列表已刷新", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.downloadZip.addEventListener("click", downloadImagesAsZip);

elements.refreshVideos.addEventListener("click", async () => {
  try {
    await loadVideos();
    showToast("视频列表已刷新", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.clearVideos.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ action: "clearVideoUrls", tabId: state.tabId });
  state.videoUrls = [];
  renderVideos();
  showToast("当前页面的视频记录已清除", "success");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === "videoListChanged" && message.tabId === state.tabId) void loadVideos();
});

async function initialize() {
  try {
    await getActiveTab();
    const [imageResult, videoResult] = await Promise.allSettled([scanImages(), loadVideos()]);
    if (imageResult.status === "rejected") {
      elements.pageSummary.textContent = imageResult.reason.message;
      elements.imageEmpty.hidden = false;
      elements.imageEmpty.textContent = imageResult.reason.message;
    }
    if (videoResult.status === "rejected") showToast(videoResult.reason.message, "error");
  } catch (error) {
    elements.pageSummary.textContent = error.message;
    showToast(error.message, "error");
  }
}

void initialize();
