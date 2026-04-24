// ── Shared ──────────────────────────────────────────────────────────────────
const activeModel = document.getElementById("activeModel");

async function loadHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    activeModel.textContent = data.model ?? "unknown";
  } catch {
    activeModel.textContent = "unavailable";
  }
}

// ── Tab switching ────────────────────────────────────────────────────────────
const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;

    tabBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === target);
      b.setAttribute("aria-selected", String(b.dataset.tab === target));
    });

    tabPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.id !== `tab-${target}`);
    });

    if (target === "copilot") {
      loadFaqs();
    }
  });
});

// ── SQL Generator tab ────────────────────────────────────────────────────────
const promptInput = document.getElementById("promptInput");
const generateBtn = document.getElementById("generateBtn");
const sqlOutput   = document.getElementById("sqlOutput");
const statusBar   = document.getElementById("statusBar");
const copyBtn     = document.getElementById("copyBtn");

function setStatus(kind, text) {
  statusBar.className = `status ${kind}`;
  statusBar.textContent = text;
}

async function generateSql() {
  const input = promptInput.value.trim();
  if (!input) {
    setStatus("error", "Enter a request first.");
    return;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = "Generating...";
  setStatus("idle", "Generating SQL…");
  sqlOutput.textContent = "";

  try {
    const res = await fetch("/api/generate-query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      sqlOutput.textContent = "";
      setStatus("error", data.message ?? "Could not generate a valid query.");
      return;
    }

    sqlOutput.textContent = data.sql;
    const warn = data.warnings?.length ? `  ⚠️ ${data.warnings.join(", ")}` : "";
    setStatus("ok", `Generated using ${data.model}${warn}`);
  } catch (err) {
    sqlOutput.textContent = "";
    setStatus("error", err instanceof Error ? err.message : "Request failed.");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate SQL";
  }
}

generateBtn.addEventListener("click", generateSql);

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    generateSql();
  }
});

copyBtn.addEventListener("click", async () => {
  const sql = sqlOutput.textContent;
  if (!sql || sql === "Your query will appear here.") return;
  try {
    await navigator.clipboard.writeText(sql);
    setStatus("ok", "Copied to clipboard.");
  } catch {
    setStatus("error", "Copy failed — select the text manually.");
  }
});

// ── PDGMS Copilot tab ────────────────────────────────────────────────────────
const copilotQuestion = document.getElementById("copilotQuestion");
const askBtn          = document.getElementById("askBtn");
const copilotAnswer   = document.getElementById("copilotAnswer");
const copilotStatus   = document.getElementById("copilotStatus");
const copyAnswerBtn   = document.getElementById("copyAnswerBtn");

function setCopilotStatus(kind, text) {
  copilotStatus.className = `status ${kind}`;
  copilotStatus.textContent = text;
}

async function askProposal() {
  const question = copilotQuestion.value.trim();
  if (!question) {
    setCopilotStatus("error", "Enter a question first.");
    return;
  }

  askBtn.disabled = true;
  askBtn.textContent = "Thinking…";
  setCopilotStatus("idle", "Searching proposals…");
  copilotAnswer.textContent = "";

  try {
    const res = await fetch("/api/proposals/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      copilotAnswer.textContent = "";
      setCopilotStatus("error", data.error ?? "Could not generate an answer.");
      return;
    }

    copilotAnswer.textContent = data.answer;

    if (data.fromCache) {
      setCopilotStatus("ok", "⚡ Answered from cache (instant — no LLM call)");
    } else {
      setCopilotStatus("ok", `Answered using LLM (${data.model})`);
    }
  } catch (err) {
    copilotAnswer.textContent = "";
    setCopilotStatus("error", err instanceof Error ? err.message : "Request failed.");
  } finally {
    askBtn.disabled = false;
    askBtn.innerHTML = "Ask  <kbd>Ctrl+&#x21B5;</kbd>";
  }
}

askBtn.addEventListener("click", askProposal);

copilotQuestion.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    askProposal();
  }
});

copyAnswerBtn.addEventListener("click", async () => {
  const text = copilotAnswer.textContent;
  if (!text || text === "Your answer will appear here.") return;
  try {
    await navigator.clipboard.writeText(text);
    setCopilotStatus("ok", "Copied to clipboard.");
  } catch {
    setCopilotStatus("error", "Copy failed — select the text manually.");
  }
});

async function loadFaqs() {
  const faqList = document.getElementById("faqList");
  try {
    const res = await fetch("/api/proposals/faqs");
    const data = await res.json();
    if (!data.ok || !data.faqs.length) {
      faqList.innerHTML = `<span class="status idle">No quick questions available.</span>`;
      return;
    }
    faqList.innerHTML = data.faqs
      .map(f => `<button class="faq-chip" data-question="${escapeHtml(f.query_text)}">${escapeHtml(f.query_text)}</button>`)
      .join("");
    faqList.querySelectorAll(".faq-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        copilotQuestion.value = btn.dataset.question;
        askProposal();
      });
    });
  } catch {
    faqList.innerHTML = `<span class="status error">Could not load quick questions.</span>`;
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Init ─────────────────────────────────────────────────────────────────────
loadHealth();
loadFaqs();
