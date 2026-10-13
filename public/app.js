const providerSelect = document.querySelector("#providerSelect");
const apiKeyInput = document.querySelector("#apiKey");
const modelSelect = document.querySelector("#modelSelect");
const workspace = document.querySelector("#workspace");
const connectionBadge = document.querySelector("#connectionBadge");
const connectionMessage = document.querySelector("#connectionMessage");
const sourceText = document.querySelector("#sourceText");
const resultText = document.querySelector("#resultText");
const progress = document.querySelector("#progress");
const saveStatus = document.querySelector("#saveStatus");
const fileInput = document.querySelector("#fileInput");
const pagePanel = document.querySelector("#pagePanel");
const pageSelection = document.querySelector("#pageSelection");
const translateButton = document.querySelector("#translateButton");
const pauseButton = document.querySelector("#pauseButton");

const database = new Promise((resolve, reject) => {
  const request = indexedDB.open("btt-system", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("state");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

let availableModels = [];
let pdfPages = [];
let selectedPdfPages = new Set();
let epubSections = [];
let selectedEpubSections = new Set();
let translationChunks = [];
let translatedChunks = [];
let nextChunkIndex = 0;
let currentChunkText = "";
let running = false;
let pauseRequested = false;
let currentAbortController = null;

const presets = {
  openai: [["gpt-4o-mini", "GPT-4o mini"], ["gpt-4o", "GPT-4o"], ["gpt-4.1-mini", "GPT-4.1 mini"], ["gpt-4.1", "GPT-4.1"]],
  openrouter: [["openai/gpt-4o-mini", "OpenAI GPT-4o mini"], ["openai/gpt-4o", "OpenAI GPT-4o"], ["openai/gpt-4.1-mini", "OpenAI GPT-4.1 mini"], ["google/gemini-2.0-flash-001", "Google Gemini 2.0 Flash"]]
};

function getCredentials() {
  return { provider: providerSelect.value, apiKey: apiKeyInput.value.trim() };
}

function setConnectionState(connected, message) {
  connectionBadge.textContent = connected ? "API configurada" : "Configure um provedor";
  connectionBadge.className = `status ${connected ? "ok" : "muted"}`;
  connectionMessage.textContent = message;
  workspace.classList.toggle("hidden", !connected);
}

function populateModels() {
  availableModels = presets[providerSelect.value].map(([id, name]) => ({ id, name }));
  modelSelect.innerHTML = "";
  for (const model of availableModels) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    modelSelect.append(option);
  }
  const saved = localStorage.getItem(`btt.selectedModel.${providerSelect.value}`);
  if (saved && [...modelSelect.options].some((option) => option.value === saved)) modelSelect.value = saved;
}

function splitText(text, maxCharacters = 8000) {
  const chunks = [];
  let current = "";
  for (const paragraph of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    if (paragraph.length > maxCharacters) {
      if (current) chunks.push(current);
      current = "";
      for (let index = 0; index < paragraph.length; index += maxCharacters) chunks.push(paragraph.slice(index, index + maxCharacters));
    } else if ((current ? `${current}\n\n${paragraph}` : paragraph).length <= maxCharacters) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function renderResult() {
  const completed = translatedChunks.filter(Boolean).join("\n\n");
  resultText.value = completed + (currentChunkText ? `${completed ? "\n\n" : ""}${currentChunkText}` : "");
}

async function saveState() {
  try {
    const db = await database;
    const transaction = db.transaction("state", "readwrite");
    transaction.objectStore("state").put({
      provider: providerSelect.value,
      model: modelSelect.value,
      sourceLanguage: document.querySelector("#sourceLanguage").value,
      targetLanguage: document.querySelector("#targetLanguage").value,
      sourceText: sourceText.value,
      resultText: resultText.value,
      translatedChunks,
      nextChunkIndex,
      translationChunks,
      pdfPages,
      selectedPdfPages: [...selectedPdfPages],
      epubSections,
      selectedEpubSections: [...selectedEpubSections],
      savedAt: new Date().toISOString()
    }, "current");
    saveStatus.textContent = "Seções salvas localmente.";
  } catch {
    saveStatus.textContent = "Não foi possível salvar localmente.";
  }
}

async function loadState() {
  try {
    const db = await database;
    const request = db.transaction("state", "readonly").objectStore("state").get("current");
    request.onsuccess = () => {
      const state = request.result;
      if (!state) return;
      providerSelect.value = state.provider || "openrouter";
      apiKeyInput.value = localStorage.getItem(`btt.apiKey.${providerSelect.value}`) || "";
      populateModels();
      if (state.model && [...modelSelect.options].some((option) => option.value === state.model)) modelSelect.value = state.model;
      document.querySelector("#sourceLanguage").value = state.sourceLanguage || "Inglês";
      document.querySelector("#targetLanguage").value = state.targetLanguage || "Português do Brasil";
      sourceText.value = state.sourceText || "";
      resultText.value = state.resultText || "";
      translationChunks = state.translationChunks || [];
      translatedChunks = state.translatedChunks || [];
      nextChunkIndex = state.nextChunkIndex || 0;
      pdfPages = state.pdfPages || [];
      selectedPdfPages = new Set(state.selectedPdfPages || []);
      epubSections = state.epubSections || [];
      selectedEpubSections = new Set(state.selectedEpubSections || []);
      renderPages();
      updateCharacterCount();
      if (translationChunks.length && nextChunkIndex < translationChunks.length) progress.textContent = `Tradução pausada no bundle ${nextChunkIndex + 1} de ${translationChunks.length}.`;
      setConnectionState(Boolean(apiKeyInput.value), apiKeyInput.value ? "Sessão restaurada." : "Cole uma chave de API para começar.");
    };
  } catch {
    setConnectionState(false, "Cole uma chave de API para começar.");
  }
}

function updateCharacterCount() {
  document.querySelector("#charCount").textContent = `${sourceText.value.length.toLocaleString("pt-BR")} caracteres`;
}

function renderPages() {
  pageSelection.innerHTML = "";
  const isEpub = epubSections.length > 0;
  const sections = isEpub ? epubSections : pdfPages.map((page) => ({ id: page.page, label: `Página ${page.page}`, text: page.text }));
  pagePanel.classList.toggle("hidden", !sections.length);
  document.querySelector("#pagePanelTitle").textContent = isEpub ? "Seções do EPUB" : "Páginas do PDF";
  for (const page of sections) {
    const label = document.createElement("label");
    label.className = "page-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isEpub ? selectedEpubSections.has(page.id) : selectedPdfPages.has(page.id);
    checkbox.addEventListener("change", () => {
      const selected = isEpub ? selectedEpubSections : selectedPdfPages;
      if (checkbox.checked) selected.add(page.id);
      else selected.delete(page.id);
      composeSelectedPages();
    });
    label.append(checkbox, document.createTextNode(`${page.label} (${page.text.length.toLocaleString("pt-BR")} caracteres)`));
    pageSelection.append(label);
  }
}

function composeSelectedPages() {
  if (epubSections.length) sourceText.value = epubSections.filter((section) => selectedEpubSections.has(section.id)).map((section) => section.text).join("\n\n");
  else sourceText.value = pdfPages.filter((page) => selectedPdfPages.has(page.page)).map((page) => page.text).join("\n\n");
  resetTranslation();
  updateCharacterCount();
  saveState();
}

function resetTranslation() {
  translationChunks = [];
  translatedChunks = [];
  nextChunkIndex = 0;
  currentChunkText = "";
  resultText.value = "";
}

async function streamBundle(index) {
  currentAbortController = new AbortController();
  currentChunkText = "";
  renderResult();
  const credentials = getCredentials();
  const response = await fetch("/api/translate-bundle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: currentAbortController.signal,
    body: JSON.stringify({
      ...credentials,
      model: modelSelect.value,
      chunk: translationChunks[index],
      sourceLanguage: document.querySelector("#sourceLanguage").value,
      targetLanguage: document.querySelector("#targetLanguage").value
    })
  });
  if (!response.body) throw new Error("A API não iniciou o streaming.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const rawEvent of events) {
      const eventName = rawEvent.match(/^event: (.+)$/m)?.[1];
      const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const data = JSON.parse(dataLine.slice(5).trim());
      if (eventName === "text") {
        currentChunkText += data.text;
        renderResult();
      }
      if (eventName === "error") throw new Error(data.error);
      if (eventName === "done") return currentChunkText;
    }
  }
  return currentChunkText;
}

async function runTranslation() {
  if (running) return;
  if (!getCredentials().apiKey) { progress.textContent = "Cole uma chave de API para começar."; return; }
  if (!sourceText.value.trim()) { progress.textContent = "Informe um texto ou carregue um arquivo."; return; }
  if (!translationChunks.length) translationChunks = splitText(sourceText.value);
  running = true;
  pauseRequested = false;
  sourceText.disabled = true;
  translateButton.disabled = true;
  pauseButton.disabled = false;
  pauseButton.textContent = "Pausar";
  try {
    for (; nextChunkIndex < translationChunks.length; nextChunkIndex += 1) {
      if (pauseRequested) break;
      progress.textContent = `Traduzindo bundle ${nextChunkIndex + 1} de ${translationChunks.length}...`;
      translatedChunks[nextChunkIndex] = await streamBundle(nextChunkIndex);
      currentChunkText = "";
      renderResult();
      await saveState();
    }
    if (nextChunkIndex >= translationChunks.length) progress.textContent = "Tradução concluída e salva localmente.";
    else progress.textContent = `Pausado no bundle ${nextChunkIndex + 1} de ${translationChunks.length}.`;
  } catch (error) {
    if (error.name === "AbortError" || pauseRequested) progress.textContent = `Pausado no bundle ${nextChunkIndex + 1}.`;
    else progress.textContent = error.message;
    await saveState();
  } finally {
    running = false;
    sourceText.disabled = false;
    translateButton.disabled = false;
    pauseButton.disabled = true;
    pauseButton.textContent = "Pausar";
    currentAbortController = null;
  }
}

translateButton.addEventListener("click", runTranslation);
pauseButton.addEventListener("click", () => {
  if (!running) return;
  pauseRequested = true;
  pauseButton.disabled = true;
  currentAbortController?.abort();
});

providerSelect.addEventListener("change", () => {
  localStorage.setItem("btt.provider", providerSelect.value);
  apiKeyInput.value = localStorage.getItem(`btt.apiKey.${providerSelect.value}`) || "";
  populateModels();
  setConnectionState(Boolean(apiKeyInput.value), apiKeyInput.value ? "Chave restaurada localmente." : "Cole uma chave de API para começar.");
  saveState();
});

apiKeyInput.addEventListener("input", () => {
  localStorage.setItem(`btt.apiKey.${providerSelect.value}`, apiKeyInput.value);
  setConnectionState(Boolean(apiKeyInput.value.trim()), apiKeyInput.value.trim() ? "Chave salva localmente." : "Cole uma chave de API para começar.");
});

modelSelect.addEventListener("change", () => {
  localStorage.setItem(`btt.selectedModel.${providerSelect.value}`, modelSelect.value);
  saveState();
});
sourceText.addEventListener("input", () => { resetTranslation(); updateCharacterCount(); saveState(); });
document.querySelector("#sourceLanguage").addEventListener("input", saveState);
document.querySelector("#targetLanguage").addEventListener("input", saveState);

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const formData = new FormData();
    formData.append("file", file);
    progress.textContent = "Lendo páginas do PDF...";
    try {
      const response = await fetch("/api/extract-pdf", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      pdfPages = data.pages;
      epubSections = [];
      selectedEpubSections = new Set();
      selectedPdfPages = new Set(pdfPages.map((page) => page.page));
      renderPages();
      composeSelectedPages();
      progress.textContent = `${pdfPages.length} página(s) carregada(s).`;
    } catch (error) { progress.textContent = error.message; }
  } else if (file.name.toLowerCase().endsWith(".epub") || file.type === "application/epub+zip") {
    const formData = new FormData();
    formData.append("file", file);
    progress.textContent = "Lendo seções do EPUB...";
    try {
      const response = await fetch("/api/extract-epub", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      epubSections = data.sections;
      selectedEpubSections = new Set(epubSections.map((section) => section.id));
      pdfPages = [];
      selectedPdfPages = new Set();
      renderPages();
      composeSelectedPages();
      progress.textContent = `${epubSections.length} seção(ões) carregada(s).`;
    } catch (error) { progress.textContent = error.message; }
  } else {
    sourceText.value = await file.text();
    pdfPages = [];
    selectedPdfPages = new Set();
    epubSections = [];
    selectedEpubSections = new Set();
    renderPages();
    resetTranslation();
    updateCharacterCount();
    progress.textContent = `${file.name} carregado.`;
    saveState();
  }
});

document.querySelector("#togglePagesButton").addEventListener("click", () => {
  const isEpub = epubSections.length > 0;
  const total = isEpub ? epubSections.length : pdfPages.length;
  const selected = isEpub ? selectedEpubSections : selectedPdfPages;
  const allSelected = selected.size === total;
  if (isEpub) selectedEpubSections = new Set(allSelected ? [] : epubSections.map((section) => section.id));
  else selectedPdfPages = new Set(allSelected ? [] : pdfPages.map((page) => page.page));
  renderPages();
  composeSelectedPages();
});

document.querySelector("#clearButton").addEventListener("click", () => {
  resetTranslation();
  sourceText.value = "";
  pdfPages = [];
  selectedPdfPages = new Set();
  epubSections = [];
  selectedEpubSections = new Set();
  fileInput.value = "";
  renderPages();
  updateCharacterCount();
  saveState();
});

document.querySelector("#copyButton").addEventListener("click", () => navigator.clipboard.writeText(resultText.value));

providerSelect.value = localStorage.getItem("btt.provider") || "openrouter";
apiKeyInput.value = localStorage.getItem(`btt.apiKey.${providerSelect.value}`) || "";
populateModels();
setConnectionState(Boolean(apiKeyInput.value), apiKeyInput.value ? "Chave restaurada localmente." : "Cole uma chave de API para começar.");
loadState();
