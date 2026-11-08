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

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => { window.__snipwiseLoaded = false; },
    });
  } catch (_) {}
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
  await injectContentScript(tab.id);
  chrome.tabs.sendMessage(tab.id, { action: "crop" });
  window.close();
});

$("modeBlank").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
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
