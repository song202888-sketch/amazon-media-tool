import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(join(root, "src/content.js"), "utf8");

function createContext(html, url, resourceEntries = []) {
  const { document } = parseHTML(html);
  let messageListener;
  const sentMessages = [];
  const context = vm.createContext({
    URL,
    document,
    location: new URL(url),
    performance: {
      getEntriesByType(type) {
        return type === "resource" ? resourceEntries : [];
      }
    },
    chrome: {
      runtime: {
        sendMessage(message) {
          sentMessages.push(message);
          return Promise.resolve({ ok: true });
        },
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          }
        }
      }
    }
  });
  vm.runInContext(source, context, { filename: "content.js" });
  return { context, sentMessages, getMessageListener: () => messageListener };
}

test("extracts, upgrades, orders and deduplicates Amazon gallery images", () => {
  const html = `
    <input id="ASIN" value="B0TEST1234">
    <span id="productTitle">  Demo / Product  </span>
    <div id="imageBlock">
      <img id="landingImage"
        data-old-hires="https://m.media-amazon.com/images/I/71MAIN.jpg"
        data-a-dynamic-image='{"https://m.media-amazon.com/images/I/71MAIN._AC_SX679_.jpg":[679,679]}'>
    </div>
    <ul id="altImages">
      <li><img src="https://m.media-amazon.com/images/I/71MAIN._AC_US100_.jpg"></li>
      <li><img src="https://m.media-amazon.com/images/I/72SECOND._AC_US100_.jpg"></li>
      <li><img src="https://images-na.ssl-images-amazon.com/images/I/73THIRD._SX38_SY50_.png"></li>
      <li class="videoThumbnail"><img src="https://m.media-amazon.com/images/I/99VIDEO._AC_US100_.jpg"></li>
      <li><img src="https://example.com/not-amazon.jpg"></li>
    </ul>`;

  const { context } = createContext(html, "https://www.amazon.com/dp/B0TEST1234");
  const product = vm.runInContext("scanProduct()", context);

  assert.equal(product.asin, "B0TEST1234");
  assert.equal(product.title, "Demo / Product");
  assert.deepEqual(
    [...product.images].map((image) => image.url),
    [
      "https://m.media-amazon.com/images/I/71MAIN.jpg",
      "https://m.media-amazon.com/images/I/72SECOND.jpg",
      "https://images-na.ssl-images-amazon.com/images/I/73THIRD.png"
    ]
  );
});

test("responds to the popup scan message without exposing arbitrary actions", () => {
  const html = `
    <meta property="og:title" content="Fallback title">
    <img id="landingImage" src="https://m.media-amazon.com/images/I/81ONLY._SL1500_.jpg">`;
  const { getMessageListener } = createContext(html, "https://www.amazon.ae/gp/product/B012345678");
  const listener = getMessageListener();
  let response;

  assert.equal(listener({ action: "unknown" }, {}, () => {}), false);
  assert.equal(
    listener({ action: "scanProductImages" }, {}, (value) => {
      response = value;
    }),
    false
  );
  assert.equal(response.asin, "B012345678");
  assert.equal(response.images[0].url, "https://m.media-amazon.com/images/I/81ONLY.jpg");
});

test("reports only matching HLS resources discovered inside the Amazon page", () => {
  const resources = [
    { name: "https://m.media-amazon.com/images/S/demo.hls720.m3u8?token=abc" },
    { name: "https://m.media-amazon.com/images/I/product.jpg" },
    { name: "https://example.com/not-a-video.m3u8" }
  ];
  const { sentMessages } = createContext("<main></main>", "https://www.amazon.sa/dp/B012345678", resources);

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].action, "foundVideoUrl");
  assert.equal(sentMessages[0].url, "https://m.media-amazon.com/images/S/demo.hls720.m3u8?token=abc");
});
