// AI Sales Assistant - Popup Script
const analyzeBtn = document.getElementById("analyzeInvoice");
const findLeadsBtn = document.getElementById("findLeads");
const openDashboardBtn = document.getElementById("openDashboard");
const statusMessage = document.getElementById("statusMessage");
const leadsCard = document.getElementById("leadsCard");
const leadsList = document.getElementById("leadsList");
const leadSource = document.getElementById("leadSource");
const debugOutput = document.getElementById("debugOutput");
const toggleDebug = document.getElementById("toggleDebug");

let lastResponse = null;

// Helper functions
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showStatus(message, type = "processing") {
  statusMessage.innerHTML = `<div class="status-message status-${type}">${message}</div>`;
}

function showError(message) {
  statusMessage.innerHTML = `<div class="error-detail">${message}</div>`;
}

function showLoading(message) {
  statusMessage.innerHTML = `
    <div class="status-message status-processing">
      <div class="spinner"></div>
      <span>${message}</span>
    </div>
  `;
}

function clearStatus() {
  statusMessage.innerHTML = "";
}

// Toggle debug output
toggleDebug.addEventListener("click", (e) => {
  e.preventDefault();
  if (debugOutput.style.display === "none" || !debugOutput.style.display) {
    debugOutput.style.display = "block";
    toggleDebug.textContent = "Hide debug info";
  } else {
    debugOutput.style.display = "none";
    toggleDebug.textContent = "Show debug info";
  }
});

// Display leads
function displayLeads(resp) {
  lastResponse = resp;
  debugOutput.textContent = JSON.stringify(resp, null, 2);

  // Hide leads card by default
  leadsCard.style.display = "none";

  // Extract leads from response (check multiple locations)
  let leads = [];
  let source = "";

  // First check debug.autoLeads (from /ingest endpoint)
  if (resp && resp.debug && resp.debug.autoLeads && resp.debug.autoLeads.leads && resp.debug.autoLeads.leads.length > 0) {
    leads = resp.debug.autoLeads.leads;
    source = resp.debug.autoLeads.source || "unknown";
  }
  // Then check legacy.leads (from findLeadsForAccount)
  else if (resp && resp.legacy && resp.legacy.leads && resp.legacy.leads.length > 0) {
    leads = resp.legacy.leads;
    source = resp.legacy.source || "unknown";
  }
  // Finally check top-level leads (from direct API calls)
  else if (resp && resp.leads && resp.leads.length > 0) {
    leads = resp.leads;
    source = resp.source || "unknown";
  }

  // If no leads found, don't show the card
  if (leads.length === 0) {
    showError("No leads found. The 4-tier system couldn't find contacts for this account.");
    return;
  }

  // Show the card and populate source
  leadsCard.style.display = "block";
  clearStatus();

  // Format source name
  const sourceNames = {
    "zoominfo": "ZoomInfo CSV",
    "public_web": "Google Places",
    "osm": "OpenStreetMap",
    "web_scraper": "Web Scraper",
    "unknown": "Unknown"
  };
  leadSource.textContent = sourceNames[source] || source;

  // Clear previous leads
  leadsList.innerHTML = "";

  // Render each lead
  leads.forEach(lead => {
    const leadDiv = document.createElement("div");
    leadDiv.className = "lead-item";

    // Contact name with badge
    const nameDiv = document.createElement("div");
    nameDiv.className = "lead-name";
    const nameText = document.createElement("span");
    nameText.textContent = lead.contactName || lead.name || "Unknown Contact";
    nameDiv.appendChild(nameText);

    // Add local/HQ badge if available
    if (lead.isLocalFacility === true) {
      const badge = document.createElement("span");
      badge.className = "badge-local";
      badge.textContent = "LOCAL";
      nameDiv.appendChild(badge);
    } else if (lead.isLocalFacility === false) {
      const badge = document.createElement("span");
      badge.className = "badge-hq";
      badge.textContent = "HQ";
      nameDiv.appendChild(badge);
    }

    // Add regional badge if applicable
    if (lead.isRegional === true) {
      const badge = document.createElement("span");
      badge.className = "badge-regional";
      badge.textContent = "REGIONAL";
      nameDiv.appendChild(badge);
    }

    // Add verified badge if applicable (only show VERIFIED, not unverified)
    if (lead.verified === true) {
      const badge = document.createElement("span");
      const level = lead.verificationLevel || 'medium';
      badge.className = `badge-verified badge-verified-${level}`;

      const levelText = level === 'high' ? 'HIGHLY VERIFIED' : level === 'medium' ? 'VERIFIED' : 'PARTIALLY VERIFIED';
      const methodsText = lead.verificationMethods || (lead.verifiedBy ? `by ${lead.verifiedBy}` : 'multi-method');
      badge.title = `${levelText} (${lead.verificationScore || 0}%) - ${methodsText}`;
      badge.textContent = level === 'high' ? '✓✓ VERIFIED' : '✓ VERIFIED';
      nameDiv.appendChild(badge);
    }
    leadDiv.appendChild(nameDiv);

    // Title
    if (lead.title) {
      const titleDiv = document.createElement("div");
      titleDiv.className = "lead-title";
      titleDiv.textContent = lead.title;
      leadDiv.appendChild(titleDiv);
    }

    // Phone number
    const phone = lead.corpPhone || lead.phone || lead.phoneNumber;
    if (phone) {
      const phoneDiv = document.createElement("div");
      phoneDiv.className = "lead-contact";
      phoneDiv.innerHTML = `<span>📞</span><a href="tel:${phone}">${phone}</a>`;
      leadDiv.appendChild(phoneDiv);
    }

    // Email
    const email = lead.email || lead.corpEmail;
    if (email) {
      const emailDiv = document.createElement("div");
      emailDiv.className = "lead-contact";
      emailDiv.innerHTML = `<span>✉️</span><a href="mailto:${email}">${email}</a>`;
      leadDiv.appendChild(emailDiv);
    }

    // Regional flag (if contact appears at multiple locations)
    if (lead.regionalFlag) {
      const flagDiv = document.createElement("div");
      flagDiv.className = "regional-flag";
      flagDiv.textContent = `⚠️ ${lead.regionalFlag}`;
      leadDiv.appendChild(flagDiv);
    }

    // Score (if from web scraper)
    if (lead.score !== undefined) {
      const scoreDiv = document.createElement("div");
      scoreDiv.className = "confidence";
      scoreDiv.textContent = `Confidence: ${lead.score}%`;
      leadDiv.appendChild(scoreDiv);
    }

    leadsList.appendChild(leadDiv);
  });

  // IMPROVEMENT 12: Call tips modal function
  function showCallTips(lead) {
    const modal = document.createElement("div");
    modal.className = "call-tips-modal";
    modal.innerHTML = `
      <div class="call-tips-content">
        <h3>📞 Call Script: ${lead.contactName}</h3>
        <p class="call-tips-role">${lead.title || 'Contact'} at ${lead.company || 'Company'}</p>

        <div class="call-tips-section">
          <h4>🎯 Opening Line:</h4>
          <p>"Hi ${(lead.contactName || 'there').split(' ')[0]}, this is [Your Name] with [Company]. I work with ${lead.roleLabel && lead.roleLabel.includes('SAFETY') ? 'safety managers' : 'facility managers'} at industrial facilities to help reduce workplace injuries from heavy, wet mats. Do you have 2 minutes?"</p>
        </div>

        <div class="call-tips-section">
          <h4>💡 Key Points:</h4>
          <ul>
            ${lead.roleLabel && lead.roleLabel.includes('SAFETY') ?
              '<li>Focus on <strong>injury prevention</strong> and OSHA compliance</li><li>Mention reducing back strain from lifting wet mats</li>' :
              '<li>Focus on <strong>operational efficiency</strong> and cost savings</li><li>Mention eliminating mat rental hassles</li>'
            }
            <li>Reference similar ${lead.company ? lead.company.split(' ')[0] : 'industrial'} facilities you work with</li>
            <li>Offer free facility assessment</li>
          </ul>
        </div>

        <div class="call-tips-section">
          <h4>❓ Discovery Questions:</h4>
          <ul>
            <li>"How are you currently handling floor mats and laundry services?"</li>
            <li>"Have you experienced any back injuries from employees handling wet mats?"</li>
            <li>"What's your current mat rental costing you per month?"</li>
          </ul>
        </div>

        <div class="call-tips-section">
          <h4>🎁 Value Proposition:</h4>
          <p>"We install automated mat systems that reduce injuries by 80% and cut mat costs by 40%. Most facilities see ROI in under 6 months."</p>
        </div>

        <button class="btn-close-tips" onclick="this.closest('.call-tips-modal').remove()">Got it!</button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  showStatus(`Found ${leads.length} lead${leads.length === 1 ? '' : 's'}`, "success");
}

// SWAPPED: Find Leads button - Analyzes invoice AND runs 4-tier lead discovery
findLeadsBtn.addEventListener("click", async () => {
  findLeadsBtn.disabled = true;
  leadsCard.style.display = "none";
  showLoading("Analyzing invoice and discovering leads... (20-30 seconds)");

  try {
    const tab = await getActiveTab();
    const url = tab?.url || "";
    const title = tab?.title || "";

    // Send telemetry
    if (self.qsSendTelemetry) {
      await self.qsSendTelemetry("popup_clicked_find_leads", { url, title });
    }

    // Call background script to capture and ingest (which runs lead discovery automatically)
    chrome.runtime.sendMessage(
      { type: "CAPTURE_AND_INGEST", tabId: tab?.id, accountName: "" },
      async (resp) => {
        if (chrome.runtime.lastError) {
          showError(`Connection error: ${chrome.runtime.lastError.message}. Make sure the server is running on localhost:5050.`);
          findLeadsBtn.disabled = false;
          return;
        }

        if (!resp) {
          showError("No response from backend. Is the server running on localhost:5050?");
          findLeadsBtn.disabled = false;
          return;
        }

        if (!resp.ok) {
          showError(`Analysis failed: ${resp.message || resp.status || "Unknown error"}`);
          debugOutput.textContent = JSON.stringify(resp, null, 2);
          debugOutput.style.display = "block";
          findLeadsBtn.disabled = false;
          return;
        }

        // Display leads from the response
        displayLeads(resp);

        // Send success telemetry
        if (self.qsSendTelemetry) {
          await self.qsSendTelemetry("find_leads_success", {
            source: resp.debug?.autoLeads?.source,
            leadCount: resp.debug?.autoLeads?.leadCount
          });
        }

        findLeadsBtn.disabled = false;
      }
    );
  } catch (e) {
    showError(`Error: ${String(e && (e.stack || e.message || e))}`);
    findLeadsBtn.disabled = false;
  }
});

// SWAPPED: Analyze Invoice button - Only analyzes for opportunities (MLA/pricing)
analyzeBtn.addEventListener("click", async () => {
  analyzeBtn.disabled = true;
  leadsCard.style.display = "none";
  showLoading("Analyzing sales opportunities...");

  try {
    const tab = await getActiveTab();
    const url = tab?.url || "";
    const title = tab?.title || "";

    // Send telemetry
    if (self.qsSendTelemetry) {
      await self.qsSendTelemetry("popup_clicked_analyze_opportunities", { url, title });
    }

    // Call background script to capture and ingest
    chrome.runtime.sendMessage(
      { type: "CAPTURE_AND_INGEST", tabId: tab?.id, accountName: "" },
      async (resp) => {
        if (chrome.runtime.lastError) {
          showError(`Connection error: ${chrome.runtime.lastError.message}`);
          analyzeBtn.disabled = false;
          return;
        }

        if (!resp) {
          showError("No response from backend. Is the server running on localhost:5050?");
          analyzeBtn.disabled = false;
          return;
        }

        if (!resp.ok) {
          showError(`Analysis failed: ${resp.message || resp.status || "Unknown error"}`);
          debugOutput.textContent = JSON.stringify(resp, null, 2);
          debugOutput.style.display = "block";
          analyzeBtn.disabled = false;
          return;
        }

        // Show opportunity analysis results
        lastResponse = resp;
        debugOutput.textContent = JSON.stringify(resp, null, 2);

        const oppCount = (resp.legacy?.opportunity?.linerAddOn?.count || 0) + (resp.legacy?.opportunity?.jacketConversion?.count || 0);
        const revenue = (resp.legacy?.opportunity?.linerAddOn?.potentialWeeklyRevenue || 0) + (resp.legacy?.opportunity?.jacketConversion?.potentialWeeklyRevenue || 0);

        if (oppCount > 0) {
          showStatus(`Found ${oppCount} opportunity${oppCount === 1 ? '' : 'ies'} ($${revenue.toFixed(2)}/week potential)`, "success");
        } else {
          showStatus("No opportunities found in this invoice", "error");
        }

        // Send success telemetry
        if (self.qsSendTelemetry) {
          await self.qsSendTelemetry("analyze_opportunities_success", {
            oppCount,
            revenue
          });
        }

        analyzeBtn.disabled = false;
      }
    );
  } catch (e) {
    showError(`Error: ${String(e && (e.stack || e.message || e))}`);
    analyzeBtn.disabled = false;
  }
});

// Open Dashboard button
openDashboardBtn.addEventListener("click", async () => {
  await chrome.tabs.create({ url: "http://localhost:5050/dashboard/manager.html" });
});

// On popup open: verify telemetry works
(async () => {
  try {
    if (self.qsSendTelemetry) {
      await self.qsSendTelemetry("popup_opened", { ui: "sales_assistant" });
    }
  } catch (e) {
    console.warn("Telemetry failed:", e);
  }
})();
