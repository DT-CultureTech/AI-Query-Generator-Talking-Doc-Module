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

    // Load proposal status when switching to PDGMS Copilot tab
    if (target === "copilot") {
      loadProposalStatus();
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
  setStatus("idle", "Generating SQL\u2026");
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
    const warn = data.warnings?.length ? `  \u26A0\uFE0F ${data.warnings.join(", ")}` : "";
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
const proposalStatusList = document.getElementById("proposalStatusList");
const ingestStatus       = document.getElementById("ingestStatus");
const ingestBtn          = document.getElementById("ingestBtn");
const reindexBtn         = document.getElementById("reindexBtn");
const copilotQuestion    = document.getElementById("copilotQuestion");
const askBtn             = document.getElementById("askBtn");
const copilotAnswer      = document.getElementById("copilotAnswer");
const copilotStatus      = document.getElementById("copilotStatus");
const copilotSources     = document.getElementById("copilotSources");
const sourcesList        = document.getElementById("sourcesList");
const copyAnswerBtn      = document.getElementById("copyAnswerBtn");

function setCopilotStatus(kind, text) {
  copilotStatus.className = `status ${kind}`;
  copilotStatus.textContent = text;
}

function setIngestStatus(kind, text) {
  ingestStatus.className = `status ${kind}`;
  ingestStatus.textContent = text;
}

async function loadProposalStatus() {
  proposalStatusList.innerHTML = '<span class="status idle">Loading…</span>';
  try {
    const res = await fetch("/api/proposals/status");
    const data = await res.json();

    if (!data.ok) {
      proposalStatusList.innerHTML = `<span class="status error">${data.error ?? "Could not load proposal status."}</span>`;
      return;
    }

    if (!data.proposals || data.proposals.length === 0) {
      proposalStatusList.innerHTML =
        '<span class="status idle">No proposals indexed yet. Click <strong>Ingest New</strong> to index the proposals folder.</span>';
      return;
    }

    proposalStatusList.innerHTML = data.proposals
      .map(
        (p) =>
          `<div class="proposal-chip">
            <span class="proposal-name">${escapeHtml(p.proposalName)}</span>
            <span class="proposal-meta">${p.chunkCount} chunks &bull; ${new Date(p.ingestedAt).toLocaleDateString()}</span>
          </div>`
      )
      .join("");
  } catch {
    proposalStatusList.innerHTML = '<span class="status error">Could not reach server.</span>';
  }
}

async function runIngest(force) {
  ingestBtn.disabled = true;
  reindexBtn.disabled = true;
  setIngestStatus("idle", force ? "Re-indexing all proposals…" : "Ingesting new proposals…");

  try {
    const res = await fetch("/api/proposals/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force })
    });
    const data = await res.json();

    if (!data.ok) {
      setIngestStatus("error", data.error ?? "Ingestion failed.");
      return;
    }

    const s = data.summary;
    const parts = [];
    if (s.filesProcessed?.length) parts.push(`Indexed: ${s.filesProcessed.join(", ")}`);
    if (s.skippedFiles?.length) parts.push(`Skipped (already done): ${s.skippedFiles.join(", ")}`);
    if (s.errors?.length) parts.push(`Warnings: ${s.errors.map((e) => e.error).join("; ")}`);

    setIngestStatus("ok", parts.join(" | ") || "Done.");
    await loadProposalStatus();
  } catch (err) {
    setIngestStatus("error", err instanceof Error ? err.message : "Request failed.");
  } finally {
    ingestBtn.disabled = false;
    reindexBtn.disabled = false;
  }
}

ingestBtn.addEventListener("click", () => runIngest(false));
reindexBtn.addEventListener("click", () => runIngest(true));

async function askProposal() {
  const question = copilotQuestion.value.trim();
  if (!question) {
    setCopilotStatus("error", "Enter a question first.");
    return;
  }

  askBtn.disabled = true;
  askBtn.textContent = "Thinking…";
  setCopilotStatus("idle", "Searching proposals and generating answer…");
  copilotAnswer.textContent = "";
  copilotSources.classList.add("hidden");

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
    setCopilotStatus("ok", `Answered using ${data.model}`);

    // Render sources
    if (data.sources && data.sources.length > 0) {
      sourcesList.innerHTML = data.sources
        .map(
          (s, i) =>
            `<div class="source-item">
              <div class="source-header">
                <span class="source-num">#${i + 1}</span>
                <span class="source-proposal">${escapeHtml(s.proposalName)}</span>
                <span class="source-score">similarity: ${(1 - s.distance).toFixed(3)}</span>
              </div>
              <p class="source-excerpt">${escapeHtml(s.excerpt)}</p>
            </div>`
        )
        .join("");
      copilotSources.classList.remove("hidden");
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
