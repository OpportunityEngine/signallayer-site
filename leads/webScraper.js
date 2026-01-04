// webScraper.js
// Tier 4: Legal web scraping for local business contacts
// Respects robots.txt, rate limits, and only uses publicly available data

const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");

// Rate limiting to be respectful
const RATE_LIMIT_MS = 2000; // 2 seconds between requests
let lastRequestTime = 0;

async function respectfulFetch(url, options = {}) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastRequest));
  }

  lastRequestTime = Date.now();

  const headers = {
    "User-Agent": "QuietSignal Lead Discovery Bot/1.0 (Respectful business contact finder)",
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });
  return response;
}

/**
 * Search for company contact page URLs
 * Uses DuckDuckGo (no API key required, allows automated queries)
 */
async function findContactPageUrls(companyName, city, state, postalCode) {
  const queries = [
    `"${companyName}" ${city} ${state} contact`,
    `"${companyName}" ${postalCode} phone`,
    `"${companyName}" ${city} manager`,
    `"${companyName}" ${city} site:linkedin.com`,
  ];

  const urls = new Set();

  for (const query of queries) {
    try {
      // DuckDuckGo HTML search (no API key needed)
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await respectfulFetch(searchUrl, { timeout: 5000 });
      const html = await response.text();
      const dom = new JSDOM(html);

      // Extract result links
      const links = dom.window.document.querySelectorAll(".result__url");
      links.forEach(link => {
        const href = link.getAttribute("href");
        if (href && !href.includes("duckduckgo.com")) {
          urls.add(href);
        }
      });

      if (urls.size >= 10) break; // Enough URLs to work with
    } catch (err) {
      console.warn(`[WEB_SCRAPER] Search query failed: ${query}`, err.message);
    }
  }

  return Array.from(urls).slice(0, 10);
}

/**
 * Extract contact information from a webpage
 * Looks for: names with titles, phone numbers, email addresses
 */
function extractContactsFromHtml(html, companyName, targetCity, targetState) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const bodyText = doc.body ? doc.body.textContent : "";

    const contacts = [];

    // Phone number patterns (US format)
    const phoneRegex = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const phones = [...new Set(bodyText.match(phoneRegex) || [])];

    // Email patterns
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emails = [...new Set(bodyText.match(emailRegex) || [])]
      .filter(e => !e.includes("example.com") && !e.includes("yourdomain"));

    // Look for structured contact sections
    const contactSections = doc.querySelectorAll('[class*="contact"], [id*="contact"], [class*="team"], [class*="staff"]');

    contactSections.forEach(section => {
      const text = section.textContent || "";

      // Pattern: Name + Title (e.g., "John Smith, Plant Manager" or "Jane Doe - Safety Director")
      const titlePatterns = [
        /([A-Z][a-z]+ [A-Z][a-z]+),?\s*[-–]\s*(Plant Manager|Site Manager|Facility Manager|Safety Manager|Maintenance Manager|Operations Manager|General Manager|Director)/gi,
        /([A-Z][a-z]+ [A-Z][a-z]+),?\s*(Plant Manager|Site Manager|Facility Manager|Safety Manager|Maintenance Manager|Operations Manager|General Manager|Director)/gi,
      ];

      titlePatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const name = match[1].trim();
          const title = match[2].trim();

          // Try to find phone near this name
          const contextText = text.substring(Math.max(0, match.index - 200), Math.min(text.length, match.index + 200));
          const contextPhone = contextText.match(phoneRegex);

          contacts.push({
            contactName: name,
            title: title,
            department: inferDepartment(title),
            phone: contextPhone ? contextPhone[0] : "",
            email: "",
            source: "web_scraped"
          });
        }
      });
    });

    // If no structured contacts found, look for phone numbers with labels
    if (contacts.length === 0 && phones.length > 0) {
      phones.forEach(phone => {
        // Try to find context around phone number
        const phoneIndex = bodyText.indexOf(phone);
        const context = bodyText.substring(Math.max(0, phoneIndex - 100), Math.min(bodyText.length, phoneIndex + 100));

        let department = "General";
        let title = "";

        if (context.toLowerCase().includes("reception") || context.toLowerCase().includes("front desk")) {
          department = "Front Desk";
          title = "Receptionist";
        } else if (context.toLowerCase().includes("main") || context.toLowerCase().includes("general")) {
          department = "Main Office";
          title = "Main Line";
        } else if (context.toLowerCase().includes("safety")) {
          department = "Safety";
          title = "Safety Contact";
        } else if (context.toLowerCase().includes("hr") || context.toLowerCase().includes("human resources")) {
          department = "Human Resources";
          title = "HR Contact";
        }

        contacts.push({
          contactName: `${companyName} ${department}`,
          title: title,
          department: department,
          phone: phone,
          email: "",
          source: "web_scraped"
        });
      });
    }

    // Add emails if found (associate with first contact or create generic contact)
    if (emails.length > 0 && contacts.length > 0) {
      contacts[0].email = emails[0];
    } else if (emails.length > 0) {
      contacts.push({
        contactName: `${companyName} Contact`,
        title: "General Contact",
        department: "General",
        phone: "",
        email: emails[0],
        source: "web_scraped"
      });
    }

    return contacts;
  } catch (err) {
    console.warn("[WEB_SCRAPER] HTML parsing failed:", err.message);
    return [];
  }
}

function inferDepartment(title) {
  const t = title.toLowerCase();
  if (t.includes("safety") || t.includes("ehs")) return "Safety";
  if (t.includes("hr") || t.includes("human resources")) return "Human Resources";
  if (t.includes("maintenance")) return "Maintenance";
  if (t.includes("operations")) return "Operations";
  if (t.includes("plant") || t.includes("site") || t.includes("facility")) return "Management";
  return "General";
}

/**
 * Check if we're allowed to scrape this URL per robots.txt
 */
async function canScrapeUrl(url) {
  try {
    const urlObj = new URL(url);
    const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;

    const response = await fetch(robotsUrl, { timeout: 3000 });
    if (!response.ok) return true; // No robots.txt = allowed

    const robotsTxt = await response.text();
    const lines = robotsTxt.split("\n");

    let currentUserAgent = null;
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();

      if (trimmed.startsWith("user-agent:")) {
        currentUserAgent = trimmed.split(":")[1].trim();
      }

      if ((currentUserAgent === "*" || currentUserAgent === "quietsignal") && trimmed.startsWith("disallow:")) {
        const path = trimmed.split(":")[1].trim();
        if (path === "/" || urlObj.pathname.startsWith(path)) {
          return false; // Disallowed
        }
      }
    }

    return true; // Allowed
  } catch (err) {
    // If we can't check robots.txt, err on the side of caution but allow
    return true;
  }
}

/**
 * Main function: Find contacts for a local business via web scraping
 */
async function findContactsViaWebScraping({ companyName, city, state, postalCode, addressHint }) {
  try {
    console.log(`[WEB_SCRAPER] Searching for contacts: ${companyName} in ${city}, ${state} ${postalCode}`);

    // Step 1: Find relevant URLs
    const urls = await findContactPageUrls(companyName, city, state, postalCode);
    console.log(`[WEB_SCRAPER] Found ${urls.length} URLs to check`);

    if (urls.length === 0) {
      return { ok: false, contacts: [], source: "web_scraper", message: "No relevant URLs found" };
    }

    // Step 2: Scrape each URL for contacts
    const allContacts = [];

    for (const url of urls) {
      try {
        // Respect robots.txt
        const allowed = await canScrapeUrl(url);
        if (!allowed) {
          console.log(`[WEB_SCRAPER] Skipping ${url} (robots.txt disallow)`);
          continue;
        }

        console.log(`[WEB_SCRAPER] Scraping ${url}`);
        const response = await respectfulFetch(url, { timeout: 5000 });

        if (!response.ok) continue;

        const html = await response.text();
        const contacts = extractContactsFromHtml(html, companyName, city, state);

        allContacts.push(...contacts);

        // Stop if we have enough contacts
        if (allContacts.length >= 5) break;

      } catch (err) {
        console.warn(`[WEB_SCRAPER] Failed to scrape ${url}:`, err.message);
      }
    }

    console.log(`[WEB_SCRAPER] Found ${allContacts.length} total contacts`);

    // Deduplicate by phone/email
    const unique = [];
    const seen = new Set();

    for (const contact of allContacts) {
      const key = `${contact.phone}|${contact.email}`;
      if (!seen.has(key) && (contact.phone || contact.email)) {
        seen.add(key);
        unique.push(contact);
      }
    }

    return {
      ok: unique.length > 0,
      contacts: unique.slice(0, 5), // Top 5
      source: "web_scraper",
      message: unique.length > 0 ? `Found ${unique.length} contacts via web scraping` : "No contacts found"
    };

  } catch (err) {
    console.error("[WEB_SCRAPER] Error:", err);
    return { ok: false, contacts: [], source: "web_scraper", message: err.message };
  }
}

module.exports = {
  findContactsViaWebScraping,
  extractContactsFromHtml,
  findContactPageUrls
};
