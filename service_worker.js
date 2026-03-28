const AUTO_STATE = "autoExtractionState";
const DEFAULT_STATE = { running: false, paused: false, tabId: null, keywords: [], site: "", currentKeywordIndex: 0, pageCount: 0 };

function buildQuery(keyword, site) {
  return encodeURIComponent(`${keyword} ("@gmail.com" OR "@hotmail.com" OR "@yahoo.com.br" OR "@outlook.com") AND site:${site}`);
}

async function getState() {
  const { [AUTO_STATE]: s } = await chrome.storage.local.get(AUTO_STATE);
  return s || { ...DEFAULT_STATE };
}

async function setState(updates) {
  const current = await getState();
  const next = { ...current, ...updates };
  await chrome.storage.local.set({ [AUTO_STATE]: next });
  return next;
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2310b981'><path d='M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z'/></svg>",
      title,
      message,
    });
  } catch (e) {}
}

async function playBeepInTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      },
    });
  } catch (e) {
    await notify("Coleta concluída", "Bipe não reproduzido (aba fechada).");
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "addEmails" && msg.emails) {
    chrome.storage.local.get(["emails"], (data) => {
      let combined = data.emails || [];
      combined = Array.from(new Set(combined.concat(msg.emails)));
      chrome.storage.local.set({ emails: combined });
    });
  } else if (msg.action === "autoExtractResult") {
    handleAutoExtractResult(msg, sender.tab?.id).then(sendResponse);
    return true;
  } else if (msg.action === "autoCaptchaDetected") {
    setState({ paused: true });
    notify("CAPTCHA detectado", "Resolva o CAPTCHA e clique em Retomar no popup.");
    sendResponse({ ok: true });
    return false;
  } else if (msg.action === "autoCaptchaResolved") {
    setState({ paused: false }).then(async (state) => {
      try {
        await chrome.tabs.sendMessage(state.tabId, { action: "autoExtractAndNext" });
      } catch (_) {}
    });
    sendResponse({ ok: true });
    return false;
  } else if (msg.action === "startAuto") {
    startAutoExtraction(msg.keywords || [], msg.site || "").then(sendResponse);
    return true;
  } else if (msg.action === "stopAuto") {
    stopAutoExtraction().then(sendResponse);
    return true;
  } else if (msg.action === "resumeAuto") {
    resumeAutoExtraction().then(sendResponse);
    return true;
  } else if (msg.action === "getAutoState") {
    getState().then(sendResponse);
    return true;
  } else if (msg.action === "autoPageReady") {
    getState().then(async (state) => {
      const tabId = sender.tab?.id;
      if (state.running && state.tabId === tabId && !state.paused) {
        try {
          await chrome.tabs.sendMessage(tabId, { action: "autoExtractAndNext" });
        } catch (_) {}
      }
    });
    return false;
  }
});

async function handleAutoExtractResult(msg, tabId) {
  const state = await getState();
  if (!state.running || state.tabId !== tabId) return { ok: true };

  if (msg.captcha) {
    await setState({ paused: true });
    await notify("CAPTCHA detectado", "Pause automático. Resolva e clique em Retomar.");
    return { ok: true };
  }

  if (msg.emails) {
    const { emails: existing } = await chrome.storage.local.get(["emails"]);
    let combined = existing || [];
    combined = Array.from(new Set(combined.concat(msg.emails)));
    await chrome.storage.local.set({ emails: combined });
  }

  if (msg.hasNext) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const next = document.querySelector("#pnnext");
        if (next) next.click();
      },
    });
    await setState({ pageCount: (state.pageCount || 0) + 1 });
    return { ok: true };
  }

  const keywords = state.keywords || [];
  const idx = (state.currentKeywordIndex || 0) + 1;
  if (idx < keywords.length) {
    const site = state.site || "";
    const url = "https://www.google.com/search?q=" + buildQuery(keywords[idx].trim(), site);
    await setState({ currentKeywordIndex: idx, pageCount: 0 });
    await chrome.tabs.update(tabId, { url });
    return { ok: true };
  }

  await setState(DEFAULT_STATE);
  await chrome.action.setBadgeText({ text: "" });
  await notify("Coleta concluída!", `Total de páginas processadas. Verifique os e-mails coletados.`);
  try {
    await playBeepInTab(tabId);
  } catch (_) {}
  return { ok: true };
}

chrome.tabs.onRemoved.addListener(async (removedTabId) => {
  const state = await getState();
  if (state.running && state.tabId === removedTabId) {
    await setState(DEFAULT_STATE);
    await chrome.action.setBadgeText({ text: "" });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[AUTO_STATE]) {
    const s = changes[AUTO_STATE].newValue;
    if (s?.running) chrome.action.setBadgeText({ text: "ON" });
    else chrome.action.setBadgeText({ text: "" });
  }
});

async function startAutoExtraction(keywords, site) {
  const kws = keywords.filter((k) => k.trim());
  if (!kws.length || !site.trim()) return { error: "Preencha ao menos uma palavra-chave e o site." };
  const url = "https://www.google.com/search?q=" + buildQuery(kws[0].trim(), site.trim());
  const tab = await chrome.tabs.create({ url, active: false });
  await setState({ running: true, paused: false, tabId: tab.id, keywords: kws, site: site.trim(), currentKeywordIndex: 0, pageCount: 0 });
  chrome.action.setBadgeText({ text: "ON" });
  return { ok: true, tabId: tab.id };
}

async function stopAutoExtraction() {
  await setState(DEFAULT_STATE);
  chrome.action.setBadgeText({ text: "" });
  return { ok: true };
}

async function resumeAutoExtraction() {
  const state = await getState();
  if (!state.running || !state.paused) return { error: "Nada para retomar." };
  await setState({ paused: false });
  try {
    await chrome.tabs.sendMessage(state.tabId, { action: "autoExtractAndNext" });
  } catch (_) {}
  return { ok: true };
}

