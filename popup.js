document.addEventListener("DOMContentLoaded", () => {
  const autoMode = document.getElementById("autoMode");
  const manualFields = document.getElementById("manualFields");
  const autoFields = document.getElementById("autoFields");
  const keywordInput = document.getElementById("keyword");
  const siteInput = document.getElementById("site");
  const keywordsInput = document.getElementById("keywords");
  const siteAutoInput = document.getElementById("siteAuto");
  const resultsArea = document.getElementById("results");
  const startAutoBtn = document.getElementById("startAuto");
  const stopAutoBtn = document.getElementById("stopAuto");
  const resumeAutoBtn = document.getElementById("resumeAuto");

  function toggleMode() {
    const isAuto = autoMode.checked;
    manualFields.style.display = isAuto ? "none" : "block";
    autoFields.style.display = isAuto ? "block" : "none";
  }
  autoMode.addEventListener("change", toggleMode);
  toggleMode();

  function updateAutoButtons(state) {
    const running = state?.running;
    const paused = state?.paused;
    startAutoBtn.style.display = running ? "none" : "inline-block";
    stopAutoBtn.style.display = running ? "inline-block" : "none";
    resumeAutoBtn.style.display = running && paused ? "inline-block" : "none";
  }

  chrome.storage.local.get(["keyword", "site", "emails", "autoExtractionState"], (data) => {
    if (data.keyword) keywordInput.value = data.keyword;
    if (data.site) {
      siteInput.value = data.site;
      siteAutoInput.value = data.site;
    }
    if (data.emails) resultsArea.value = (data.emails || []).join("\n");
    if (data.keywords) keywordsInput.value = data.keywords;
    updateAutoButtons(data.autoExtractionState);
  });

  function buildQuery(keyword, site) {
    return encodeURIComponent(
      `${keyword} ("@gmail.com" OR "@hotmail.com" OR "@yahoo.com.br" OR "@outlook.com") AND site:${site}`
    );
  }

  document.getElementById("start").addEventListener("click", () => {
    const keyword = keywordInput.value.trim();
    const site = siteInput.value.trim();
    if (!keyword || !site) return alert("Preencha palavra-chave e site");
    const url = "https://www.google.com/search?q=" + buildQuery(keyword, site);
    chrome.tabs.create({ url });
    chrome.storage.local.set({ keyword, site });
  });

  startAutoBtn.addEventListener("click", async () => {
    const raw = keywordsInput.value.trim();
    const keywords = raw ? raw.split("\n").map((k) => k.trim()).filter(Boolean) : [keywordInput.value.trim()];
    const site = siteAutoInput.value.trim();
    if (!keywords.length || !site) return alert("Preencha ao menos uma palavra-chave e o site");
    const r = await chrome.runtime.sendMessage({ action: "startAuto", keywords, site });
    if (r?.error) return alert(r.error);
    chrome.storage.local.set({ site });
    updateAutoButtons({ running: true, paused: false });
  });

  stopAutoBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ action: "stopAuto" });
    updateAutoButtons({ running: false });
  });

  resumeAutoBtn.addEventListener("click", async () => {
    const r = await chrome.runtime.sendMessage({ action: "resumeAuto" });
    if (r?.error) return alert(r.error);
    updateAutoButtons({ running: true, paused: false });
  });

  document.getElementById("next").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const next = document.querySelector("#pnnext");
          if (next) next.click();
        },
      });
    });
  });

  document.getElementById("clear").addEventListener("click", () => {
    chrome.storage.local.set({ emails: [] });
    resultsArea.value = "";
  });

  document.getElementById("download").addEventListener("click", () => {
    chrome.storage.local.get(["emails"], (data) => {
      const emails = data.emails || [];
      if (!emails.length) return alert("Nenhum email para exportar");
      const blob = new Blob([emails.join("\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "emails.txt";
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.emails) resultsArea.value = (changes.emails.newValue || []).join("\n");
      if (changes.autoExtractionState) updateAutoButtons(changes.autoExtractionState.newValue);
    }
  });

  setInterval(() => {
    chrome.runtime.sendMessage({ action: "getAutoState" }, (state) => {
      if (state) updateAutoButtons(state);
    });
  }, 1000);
});
