function extractEmailsFromText(text) {
  const regex = /[a-zA-Z0-9._%+-]+@(gmail\.com|hotmail\.com|yahoo\.com\.br|outlook\.com)/gi;
  return Array.from(new Set((text.match(regex) || []).map((e) => e.toLowerCase())));
}

function collectEmailsFromPage() {
  const elements = document.querySelectorAll("body, body *");
  let emails = [];
  elements.forEach((el) => {
    if (el.innerText) emails = emails.concat(extractEmailsFromText(el.innerText));
  });
  return Array.from(new Set(emails));
}

function detectCaptcha() {
  const body = document.body?.innerText || "";
  if (/unusual traffic|captcha|recaptcha|não é um robô|não é um robô/i.test(body)) return true;
  if (document.querySelector("#recaptcha, .g-recaptcha, iframe[src*='recaptcha']")) return true;
  if (document.querySelector("form[action*='sorry']") || document.getElementById("captcha-form")) return true;
  return false;
}

function hasNextPage() {
  const next = document.querySelector("#pnnext");
  return !!(next && !next.classList.contains("disabled"));
}

let captchaCheckInterval = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "autoExtractAndNext") {
    if (detectCaptcha()) {
      chrome.runtime.sendMessage({ action: "autoExtractResult", captcha: true });
      captchaCheckInterval = setInterval(() => {
        if (!detectCaptcha()) {
          clearInterval(captchaCheckInterval);
          captchaCheckInterval = null;
          chrome.runtime.sendMessage({ action: "autoCaptchaResolved" });
        }
      }, 2000);
      sendResponse({ captcha: true });
      return;
    }
    const emails = collectEmailsFromPage();
    const hasNext = hasNextPage();
    chrome.runtime.sendMessage({
      action: "autoExtractResult",
      emails,
      hasNext,
    });
    sendResponse({ ok: true });
    return;
  }
});

if (location.hostname.includes("google") && location.pathname.includes("/search")) {
  chrome.runtime.sendMessage({ action: "autoPageReady" });
}

const emailsFound = collectEmailsFromPage();
if (emailsFound.length > 0) {
  chrome.runtime.sendMessage({ action: "addEmails", emails: emailsFound });
}
