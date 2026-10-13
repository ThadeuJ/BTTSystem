import express from "express";
import { XMLParser } from "fast-xml-parser";
import { convert } from "html-to-text";
import JSZip from "jszip";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDirectory = fileURLToPath(new URL("./public/", import.meta.url));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const providers = {
  openai: { chatUrl: "https://api.openai.com/v1/chat/completions" },
  openrouter: { chatUrl: "https://openrouter.ai/api/v1/chat/completions" }
};

const modelPresets = {
  openai: [
    { id: "gpt-4o-mini", name: "GPT-4o mini" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 mini" },
    { id: "gpt-4.1", name: "GPT-4.1" }
  ],
  openrouter: [
    { id: "openai/gpt-4o-mini", name: "OpenAI GPT-4o mini" },
    { id: "openai/gpt-4o", name: "OpenAI GPT-4o" },
    { id: "openai/gpt-4.1-mini", name: "OpenAI GPT-4.1 mini" },
    { id: "google/gemini-2.0-flash-001", name: "Google Gemini 2.0 Flash" }
  ]
};

app.use(express.json({ limit: "25mb" }));
app.use(express.static(publicDirectory));

function getProvider(provider) {
  const selected = providers[provider];
  if (!selected) throw new Error("Provedor inválido.");
  return selected;
}

function getApiKey(request) {
  const key = request.body?.apiKey?.trim();
  if (!key) throw new Error("Cole a chave da API para continuar.");
  if (key.length > 500) throw new Error("A chave informada é inválida.");
  return key;
}

function providerHeaders(provider, apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = `http://localhost:${port}`;
    headers["X-Title"] = "BTT System";
  }
  return headers;
}

function translationMessages(sourceLanguage, targetLanguage, chunk) {
  return [
    {
      role: "system",
      content: "Você é um tradutor profissional. Traduza somente o texto recebido. Preserve o máximo possível a formatação, quebras de linha, Markdown, HTML, placeholders, URLs, códigos e nomes próprios. Não explique, resuma ou adicione conteúdo."
    },
    {
      role: "user",
      content: `Traduza de ${sourceLanguage} para ${targetLanguage}. Retorne somente a tradução.\n\n${chunk}`
    }
  ];
}

function sendEvent(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get("/api/models", (request, response) => {
  response.json({ models: modelPresets[request.query.provider] || [] });
});

app.post("/api/extract-pdf", upload.single("file"), async (request, response) => {
  try {
    if (!request.file) throw new Error("Selecione um arquivo PDF.");
    const pageTexts = [];
    await pdfParse(request.file.buffer, {
      pagerender: async (pageData) => {
        const content = await pageData.getTextContent();
        const text = content.items.map((item) => item.str).join(" ").trim();
        pageTexts.push({ page: pageData.pageIndex + 1, text });
        return text;
      }
    });
    pageTexts.sort((a, b) => a.page - b.page);
    response.json({ fileName: request.file.originalname, pages: pageTexts });
  } catch (error) {
    response.status(400).json({ error: error.message || "Não foi possível ler o PDF." });
  }
});

function asArray(value) {
  return value ? (Array.isArray(value) ? value : [value]) : [];
}

function resolveZipPath(basePath, relativePath) {
  const parts = `${basePath}/${relativePath}`.split("/");
  const resolved = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

app.post("/api/extract-epub", upload.single("file"), async (request, response) => {
  try {
    if (!request.file) throw new Error("Selecione um arquivo EPUB.");
    const zip = await JSZip.loadAsync(request.file.buffer);
    const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const containerXml = await zip.file("META-INF/container.xml")?.async("text");
    if (!containerXml) throw new Error("EPUB inválido: container.xml não encontrado.");
    const container = xmlParser.parse(containerXml);
    const rootFile = asArray(container.container?.rootfiles?.rootfile)[0];
    const packagePath = rootFile?.["@_full-path"];
    if (!packagePath) throw new Error("EPUB inválido: arquivo OPF não encontrado.");

    const packageFile = zip.file(packagePath);
    if (!packageFile) throw new Error("EPUB inválido: arquivo OPF não encontrado.");
    const opf = xmlParser.parse(await packageFile.async("text"));
    const opfRoot = opf.package;
    const manifestItems = asArray(opfRoot?.manifest?.item);
    const manifest = new Map(manifestItems.map((item) => [item["@_id"], item]));
    const spineItems = asArray(opfRoot?.spine?.itemref);
    const basePath = packagePath.includes("/") ? packagePath.slice(0, packagePath.lastIndexOf("/")) : "";
    const sections = [];

    for (let index = 0; index < spineItems.length; index += 1) {
      const manifestItem = manifest.get(spineItems[index]["@_idref"]);
      if (!manifestItem?.["@_href"]) continue;
      const href = decodeURIComponent(manifestItem["@_href"]).split("#")[0].split("?")[0];
      const chapterPath = resolveZipPath(basePath, href);
      const chapterFile = zip.file(chapterPath);
      if (!chapterFile) continue;
      const html = await chapterFile.async("text");
      const text = convert(html, { wordwrap: false, preserveNewlines: true }).trim();
      if (text) sections.push({ id: `section-${index + 1}`, label: `Seção ${index + 1}`, text });
    }

    if (!sections.length) throw new Error("Não foi possível encontrar texto no EPUB.");
    response.json({ fileName: request.file.originalname, sections });
  } catch (error) {
    response.status(400).json({ error: error.message || "Não foi possível ler o EPUB." });
  }
});

app.post("/api/translate-bundle", async (request, response) => {
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();

  const upstreamController = new AbortController();
  request.on("aborted", () => upstreamController.abort());

  try {
    const { provider, model, chunk, sourceLanguage = "o idioma original", targetLanguage = "o idioma de destino" } = request.body;
    const config = getProvider(provider);
    const apiKey = getApiKey(request);
    if (!chunk?.trim()) throw new Error("O bundle está vazio.");
    if (!model) throw new Error("Selecione um modelo.");

    const upstream = await fetch(config.chatUrl, {
      method: "POST",
      headers: { ...providerHeaders(provider, apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: translationMessages(sourceLanguage, targetLanguage, chunk),
        temperature: 0.2,
        stream: true
      }),
      signal: upstreamController.signal
    });
    if (!upstream.ok) {
      const body = await upstream.json().catch(() => ({}));
      throw new Error(body?.error?.message || `A API respondeu com HTTP ${upstream.status}.`);
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bundleText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const rawEvent of events) {
        const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const data = dataLine.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || "";
        if (delta) {
          bundleText += delta;
          sendEvent(response, "text", { text: delta });
        }
      }
    }

    if (!bundleText) throw new Error("A API não retornou conteúdo traduzido.");
    sendEvent(response, "done", { complete: true });
  } catch (error) {
    if (!upstreamController.signal.aborted) sendEvent(response, "error", { error: error.message || "Falha ao traduzir." });
  } finally {
    response.end();
  }
});

app.listen(port, () => {
  console.log(`BTT System disponível em http://localhost:${port}`);
});
