"use strict";

const $ = (id) => document.getElementById(id);

function applyTheme(light) {
  document.documentElement.classList.toggle("light", light);
}
chrome.storage.local.get(["theme"], (r) => applyTheme(r.theme !== "dark"));
$("themeBtn").addEventListener("click", () => {
  const light = !document.documentElement.classList.contains("light");
  applyTheme(light);
  chrome.storage.local.set({ theme: light ? "light" : "dark" });
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isInjectableTab(tab) {
  if (!tab?.url) return false;
  return tab.url.startsWith("http://") || tab.url.startsWith("https://");
}

// Make sure the crop script is running in the page, without ever stacking a second copy.
async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { action: "ping" });
    if (r && r.ok) return;
  } catch (_) {
    /* nothing listening yet */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

$("modeVisible").addEventListener("click", async () => {
  const tab = await getActiveTab();
  chrome.runtime.sendMessage({
    action: "captureVisible", title: tab.title, url: tab.url, mode: "screenshot",
  });
  window.close();
});

$("modeFull").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!isInjectableTab(tab)) {
    alert("Snipwise cannot capture this page.\nNavigate to a regular website first.");
    return;
  }
  chrome.runtime.sendMessage({
    action: "capturePage", tabId: tab.id, title: tab.title, url: tab.url, mode: "screenshot",
  });
  window.close();
});

$("modeCrop").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!isInjectableTab(tab)) {
    alert("Snipwise cannot capture this page.\nNavigate to a regular website first.");
    return;
  }
  try {
    await ensureContentScript(tab.id);
    // wait for the page to confirm: closing the popup first could drop the message
    const ack = await chrome.tabs.sendMessage(tab.id, { action: "crop" });
    if (!ack || !ack.ok) throw new Error("no answer from the page");
  } catch (_) {
    alert("Snipwise couldn't start the crop tool on this page.\nReload the page and try again.");
    return;
  }
  window.close();
});

$("docsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("docs.html") });
});

$("modeBlank").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("studio.html") });
  window.close();
});

$("modePdf").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!isInjectableTab(tab)) {
    alert("Snipwise cannot capture this page.\nNavigate to a regular website first.");
    return;
  }
  chrome.runtime.sendMessage({
    action: "capturePage", tabId: tab.id, title: tab.title, url: tab.url, mode: "pdf",
  });
  window.close();
});
