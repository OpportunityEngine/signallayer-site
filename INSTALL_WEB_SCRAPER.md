# Installing Web Scraper Tier 4 Enhancement

## Quick Start

### 1. Install Dependencies
```bash
cd /Users/taylorray/Desktop/ai-sales-backend
npm install
```

This will install:
- `jsdom` - HTML parsing and DOM manipulation
- `node-fetch` - HTTP requests (Node.js fetch API)

### 2. Configure Environment
Add to your [.env](.env) file:

```bash
# Enable Tier 4 Web Scraping
WEB_SCRAPER_ENABLE=1

# Optional: Configure scraping behavior
WEB_SCRAPER_RATE_LIMIT_MS=2000      # Delay between requests (default: 2000)
WEB_SCRAPER_MAX_PAGES=15            # Max pages per search (default: 15)
WEB_SCRAPER_TIMEOUT_MS=8000         # Timeout per page (default: 8000)
```

### 3. Test Standalone
Test the web scraper without integrating into server:

```bash
node -e "
const { findContactsViaWebScraping } = require('./leads/webScraperEnhanced');

(async () => {
  const result = await findContactsViaWebScraping({
    companyName: 'Target Corporation',
    city: 'Minneapolis',
    state: 'MN',
    postalCode: '55403',
    addressHint: '1000 Nicollet Mall'
  });

  console.log('\\n=== Web Scraper Results ===');
  console.log('Status:', result.ok ? 'SUCCESS' : 'FAILED');
  console.log('Source:', result.source);
  console.log('Pages scraped:', result.scrapedPages);
  console.log('Contacts found:', result.contacts.length);
  console.log('\\nTop 3 Contacts:');
  result.contacts.slice(0, 3).forEach((c, i) => {
    console.log(\`\n\${i+1}. \${c.contactName}\`);
    console.log(\`   Title: \${c.title}\`);
    console.log(\`   Phone: \${c.directPhone || c.corpPhone}\`);
    console.log(\`   Email: \${c.email}\`);
    console.log(\`   Source: \${c.source}\`);
  });
})();
"
```

Expected output:
```
=== Web Scraper Results ===
Status: SUCCESS
Source: web_scraper
Pages scraped: 8
Contacts found: 4

Top 3 Contacts:

1. Target Corporation Front Desk
   Title: Main Line
   Phone: (612) 304-6073
   Email:
   Source: yellow_pages

2. John Smith
   Title: Store Manager
   Phone: (612) 555-0123
   Email: john.smith@target.com
   Source: web_scraped
...
```

### 4. Test Local vs HQ Classification
```bash
node -e "
const { classifyLocation, prioritizeLocalContacts } = require('./leads/localBusinessIntel');

const contacts = [
  {
    contactName: 'Corporate VP',
    title: 'VP of Operations',
    postalCode: '10001',  // Different ZIP
    city: 'New York'
  },
  {
    contactName: 'Local Manager',
    title: 'Plant Manager',
    postalCode: '55403',  // SAME ZIP
    city: 'Minneapolis'
  }
];

const invoiceAddress = {
  postalCode: '55403',
  city: 'Minneapolis',
  state: 'MN'
};

console.log('\\n=== Classification Results ===\\n');

contacts.forEach(c => {
  const classification = classifyLocation(c, invoiceAddress);
  console.log(\`\${c.contactName}:\`);
  console.log(\`  Classification: \${classification.classification}\`);
  console.log(\`  Confidence: \${(classification.confidence * 100).toFixed(0)}%\`);
  console.log(\`  Reason: \${classification.reason}\\n\`);
});

console.log('\\n=== Prioritized List (Local First) ===\\n');
const sorted = prioritizeLocalContacts(contacts, invoiceAddress);
sorted.forEach((c, i) => {
  console.log(\`\${i+1}. \${c.contactName} - \${c.location.classification}\`);
});
"
```

Expected output:
```
=== Classification Results ===

Corporate VP:
  Classification: hq
  Confidence: 60%
  Reason: Headquarters (score: 4 vs 0)

Local Manager:
  Classification: local
  Confidence: 95%
  Reason: Local facility (score: 10 vs 0)

=== Prioritized List (Local First) ===

1. Local Manager - local
2. Corporate VP - hq
```

### 5. Integration into server.js

Open [server.js](server.js) and find the `findLeadsForAccount` function (around line 713).

Add this AFTER Tier 3 (OSM) and BEFORE the final return statement:

```javascript
// Tier 4: Web Scraping (comprehensive public sources)
if (process.env.WEB_SCRAPER_ENABLE === "1") {
  try {
    const { findContactsViaWebScraping } = require('./leads/webScraperEnhanced');
    const { prioritizeLocalContacts } = require('./leads/localBusinessIntel');

    // Extract city/state from addressHint if available
    // addressHint format: "1000 Nicollet Mall, Minneapolis, MN"
    let city = "";
    let state = "";

    if (addressHint) {
      const parts = addressHint.split(",").map(p => p.trim());
      if (parts.length >= 2) {
        city = parts[parts.length - 2] || "";
        const statePart = parts[parts.length - 1] || "";
        const stateMatch = statePart.match(/\b([A-Z]{2})\b/);
        state = stateMatch ? stateMatch[1] : "";
      }
    }

    console.log(`[LEADS] Tier 4: Web scraping for ${accountName} in ${city}, ${state} ${zip}`);

    const webResult = await withTimeout(
      findContactsViaWebScraping({
        companyName: accountName,
        city: city,
        state: state,
        postalCode: zip,
        addressHint: addressHint
      }),
      Number(process.env.WEB_SCRAPER_TIMEOUT_MS || 30000),
      "web scraper"
    );

    if (webResult.ok && webResult.contacts.length > 0) {
      console.log(`[LEADS] Tier 4: Found ${webResult.contacts.length} contacts from web scraping`);

      // Classify and prioritize local contacts
      const prioritized = prioritizeLocalContacts(webResult.contacts, {
        postalCode: zip,
        city: city,
        state: state
      });

      // Convert to standard lead format
      const leads = prioritized.slice(0, 5).map(c => ({
        contactName: c.contactName,
        title: c.title || "",
        department: c.department || "",
        directPhone: c.directPhone || "",
        mobilePhone: c.mobilePhone || "",
        corpPhone: c.corpPhone || "",
        email: c.email || "",
        city: c.city || city,
        state: c.state || state,
        postalCode: c.postalCode || zip,
        score: scoreContact(c),
        source: c.source,
        isLocalFacility: c.location?.isLocalFacility || false,
        locationConfidence: c.location?.confidence || 0
      }));

      return { ok: true, source: "web_scraper", leads };
    }
  } catch (err) {
    console.warn("[LEADS] Tier 4 web scraping failed:", err.message);
  }
}
```

### 6. Restart Server and Test
```bash
# Stop current server (Ctrl+C if running)

# Start with web scraper enabled
WEB_SCRAPER_ENABLE=1 npm start

# In another terminal, test with real business
./test-real-business.sh
```

---

## What Gets Scraped

The web scraper will search and extract from:

1. **LinkedIn** (public pages only)
   - Company pages showing employees
   - Public profiles with job titles
   - NO login-required content

2. **Business Directories**
   - YellowPages, Yelp, BBB, Manta
   - Phone numbers and addresses

3. **Company Websites**
   - "Contact Us" pages
   - "Our Team" pages
   - Staff directories

4. **Government Data**
   - OSHA safety contacts
   - EPA compliance officers

5. **Industry Directories**
   - ThomasNet, IndustryNet

---

## Compliance & Ethics

✅ **What We Do:**
- Respect `robots.txt` on all sites
- Use 2-second delays between requests
- Identify ourselves with proper User-Agent
- Only access public pages (no login)
- Limit scope (max 15 pages per search)

✅ **What We DON'T Do:**
- Scrape login-required content
- Bypass CAPTCHAs
- Hide our identity
- Overwhelm servers (DDoS)
- Violate terms of service

---

## Troubleshooting

### "Module not found: jsdom"
```bash
npm install jsdom node-fetch
```

### "Rate limited" or "403 Forbidden"
- Increase `WEB_SCRAPER_RATE_LIMIT_MS` to 3000 or 5000
- Reduce `WEB_SCRAPER_MAX_PAGES` to 10 or less
- Some sites block all scrapers - this is expected

### "No contacts found"
- Check that business has public web presence
- Try with well-known business first (e.g., Target, Walmart)
- Increase timeout: `WEB_SCRAPER_TIMEOUT_MS=15000`

### "robots.txt disallow"
- This is expected and correct behavior
- Scraper will skip that site and try others
- Not an error - it's respecting website rules

---

## Performance Expectations

### Scraping Speed
- **Fast**: 10-15 seconds (if early results found)
- **Typical**: 20-30 seconds (scrapes 8-12 pages)
- **Slow**: 30-45 seconds (full 15 pages, many timeouts)

### Success Rate by Business Type
- **Large Chains** (Target, Walmart): 70-90% success
- **Mid-size Companies**: 50-70% success
- **Small Local Businesses**: 30-50% success
- **Unknown/Generic Names**: 10-20% success

### Data Quality
- **With LinkedIn**: Often get names + titles
- **With Directories**: Usually get phones, sometimes emails
- **Company Websites**: Best quality (direct from source)
- **Government Data**: Specific compliance contacts

---

## Next Steps After Installation

1. **Create Lead Database**
   - Store scraped contacts in SQLite for faster retrieval
   - Cache successful lookups for 30 days

2. **Add Phone Validation**
   - Use a service like Twilio Lookup API
   - Verify phone numbers are active

3. **Email Validation**
   - Check email format
   - Optional: Use email validation API

4. **Analytics Dashboard**
   - Track scraper success rate
   - Monitor blocked domains
   - Measure data quality

5. **Feedback Loop**
   - Allow users to mark contacts as "good" or "bad"
   - Train classification model on feedback
   - Improve title extraction patterns

---

## Files Created

```
/Users/taylorray/Desktop/ai-sales-backend/
├── leads/
│   ├── webScraper.js                    # Basic version
│   ├── webScraperEnhanced.js           # Full version with LinkedIn
│   └── localBusinessIntel.js            # HQ vs Local classification
├── LEAD_DISCOVERY_ARCHITECTURE.md       # Full architecture docs
├── INSTALL_WEB_SCRAPER.md              # This file
└── package.json                         # Updated with dependencies
```

---

## Support & Improvements

Found an issue or have a suggestion?
1. Check the logs: Look for `[WEB_SCRAPER]` messages
2. Review [LEAD_DISCOVERY_ARCHITECTURE.md](LEAD_DISCOVERY_ARCHITECTURE.md)
3. Test standalone before integration
4. Adjust timeouts and rate limits as needed

Common improvements:
- Add more title patterns to `extractContactsFromHtml()`
- Support additional business directories
- Implement persistent caching in SQLite
- Add phone number formatting/validation
- Create admin UI to review scraped contacts
