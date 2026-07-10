// Heuristics for pulling place names out of Google Maps' saved-list DOM.
//
// Google doesn't expose an API for personal saved lists, and the markup
// uses short hashed class names that change over time. We anchor on the
// typography classes Google's design system uses ("fontHeadlineSmall" for
// a place name, "fontHeadlineLarge" for the list title) since those are
// far more stable than the hashed ones. This is inherently best-effort —
// if Google reshuffles the panel, re-check the selectors below.

// Self-contained: this is passed directly to chrome.scripting.executeScript
// as `func`, which serializes it via toString() and re-evaluates it inside
// the Maps tab. It cannot reference anything outside its own body, so the
// extraction logic is duplicated (in spirit) from parseImportedHtml below.
export async function scrapePageForSavedPlaces() {
  // Walk text nodes under `root` (skipping ones inside `excludeEl` and inside
  // any [role="img"] rating badge) and return the first non-empty one. The
  // place's type/category text sits in an arbitrarily-nested span with no
  // reliable class of its own, so we can't select it directly — the rating
  // badge (e.g. "4.5 stars, 1,272 Reviews") comes first in DOM order and has
  // to be explicitly skipped or it gets mistaken for the category.
  function firstOtherText(doc, root, excludeEl) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (excludeEl.contains(node)) continue;
      if (node.parentElement && node.parentElement.closest('[role="img"]')) continue;
      const text = node.textContent.trim();
      if (text) return text;
    }
    return "";
  }

  function extract(doc) {
    const titleEl = doc.querySelector('[class*="fontHeadlineLarge"]');
    const listName = titleEl ? titleEl.textContent.trim() : "Saved places";

    const seen = new Set();
    const places = [];
    doc.querySelectorAll('[class*="fontHeadlineSmall"]').forEach((nameEl) => {
      const name = nameEl.textContent.trim();
      if (!name || seen.has(name)) return;

      const card = nameEl.closest('[class*="fontBodyMedium"]') || nameEl.parentElement;
      const type = card ? firstOtherText(doc, card, nameEl) : "";

      let url = "";
      if (card) {
        const anchor = card.querySelector('a[href]');
        if (anchor) url = anchor.href;
      }

      seen.add(name);
      places.push({ name, type, addressHint: "", listName, url });
    });
    return places;
  }

  function findScrollContainer() {
    const nameEls = document.querySelectorAll('[class*="fontHeadlineSmall"]');
    for (const el of nameEls) {
      let node = el.parentElement;
      let depth = 0;
      while (node && depth < 10) {
        if (node.scrollHeight - node.clientHeight > 20) return node;
        node = node.parentElement;
        depth++;
      }
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const container = findScrollContainer();
  if (container) {
    let lastCount = 0;
    for (let i = 0; i < 40; i++) {
      container.scrollTop = container.scrollHeight;
      await sleep(500);
      const count = document.querySelectorAll('[class*="fontHeadlineSmall"]').length;
      if (count === lastCount) break;
      lastCount = count;
    }
  }

  return extract(document);
}

// Same text-node-walk approach as scrapePageForSavedPlaces above (kept as a
// separate copy there since that function must be self-contained to survive
// chrome.scripting.executeScript's serialization).
function firstOtherText(doc, root, excludeEl) {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (excludeEl.contains(node)) continue;
    if (node.parentElement && node.parentElement.closest('[role="img"]')) continue;
    const text = node.textContent.trim();
    if (text) return text;
  }
  return "";
}

// Parses a saved HTML export (File > Save Page As, or a copy of the saved
// list panel's outerHTML) using the same class-name heuristic.
export function parseImportedHtml(htmlString, fallbackListName) {
  const doc = new DOMParser().parseFromString(htmlString, "text/html");
  const titleEl = doc.querySelector('[class*="fontHeadlineLarge"]');
  const listName = (titleEl && titleEl.textContent.trim()) || fallbackListName || "Imported list";

  const seen = new Set();
  const places = [];
  doc.querySelectorAll('[class*="fontHeadlineSmall"]').forEach((nameEl) => {
    const name = nameEl.textContent.trim();
    if (!name || seen.has(name)) return;

    const card = nameEl.closest('[class*="fontBodyMedium"]') || nameEl.parentElement;
    const type = card ? firstOtherText(doc, card, nameEl) : "";

    let url = "";
    if (card) {
      const anchor = card.querySelector('a[href]');
      if (anchor) url = anchor.href;
    }

    seen.add(name);
    places.push({ name, type, addressHint: "", listName, url });
  });
  return places;
}

// Parses the data/campgrounds.json-style export already used by rv_routing,
// so that dataset can be imported here too: [{name, list, type, address_hint}].
export function parseImportedJson(jsonString) {
  const data = JSON.parse(jsonString);
  if (!Array.isArray(data)) throw new Error("Expected a JSON array of places");
  return data.map((p) => ({
    name: p.name,
    type: p.type || "",
    addressHint: p.address_hint || p.addressHint || "",
    listName: p.list || p.listName || "Imported list",
    url: p.url || "",
  }));
}
