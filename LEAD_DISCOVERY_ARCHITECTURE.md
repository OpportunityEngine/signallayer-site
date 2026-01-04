# Lead Discovery Architecture - Multi-Tier System

## Overview
This system finds local business contacts (not HQ) using a cascading multi-tier approach that combines proprietary data, public APIs, and legal web scraping.

## Tier Breakdown

### **Tier 1: ZoomInfo CSV** (Proprietary - Best Quality)
**Source:** `zoominfo-contacts.csv`
**Data Quality:** ⭐⭐⭐⭐⭐
**Returns:**
- Contact names
- Job titles (Plant Manager, Safety Manager, Site Manager, etc.)
- Direct phone numbers
- Mobile phones
- Corporate phones
- Email addresses
- Department information
- Postal codes for location matching

**Matching Logic:**
1. Normalized company name match
2. ZIP code exact match (or proceed without if not available)
3. Scores contacts based on:
   - Phone availability: Direct (40 pts) > Mobile (35 pts) > Corporate (25 pts)
   - Role relevance: Reception (+15), HR (+10), Maintenance/Safety (+8)

**Local vs HQ Distinction:** YES - Uses ZIP matching to find local facility contacts

---

### **Tier 2: Google Places API** (Public - Main Phone)
**Source:** Google Maps API
**Data Quality:** ⭐⭐⭐⭐
**Returns:**
- Business main phone number
- Formatted address
- Business name verification

**Matching Logic:**
1. Text search with company name + ZIP
2. Retrieve place details for formatted phone
3. Returns "Main Line" contact

**Local vs HQ Distinction:** PARTIAL - Uses ZIP to target local location, but often returns general business phone

**Requirement:** `GOOGLE_PLACES_API_KEY` environment variable

---

### **Tier 3: OpenStreetMap** (Public - Location Verification)
**Source:** Nominatim + Overpass API
**Data Quality:** ⭐⭐⭐
**Returns:**
- Business phone (if tagged in OSM)
- Business name
- Location verification

**Matching Logic:**
1. ZIP-first Overpass lookup (preferred)
2. Fallback to Nominatim geocoding
3. ZIP hard-gate validation
4. Overpass phone tag extraction

**Local vs HQ Distinction:** YES - Enforces ZIP matching

**Configuration:**
- `OSM_ENABLE=1` to enable
- `OSM_ZIPFIRST_TIMEOUT_MS` (default: 4000)
- `OSM_NOMINATIM_TIMEOUT_MS` (default: 6000)
- `OSM_OVERPASS_TIMEOUT_MS` (default: 7000)
- `OSM_OVERPASS_RADIUS_M` (default: 120)

---

### **Tier 4: Web Scraping** (Public - Comprehensive)
**Source:** Legal web scraping of public data
**Data Quality:** ⭐⭐⭐⭐ (when successful)
**Implementation:** `leads/webScraperEnhanced.js`

**Data Sources (All Legal & Public):**

1. **LinkedIn Public Pages**
   - `linkedin.com/company/*` - Company pages
   - `linkedin.com/in/*` - Public profiles
   - Extracts: Names, titles, roles
   - Does NOT scrape login-required content

2. **Business Directories**
   - YellowPages.com
   - Yelp.com
   - BBB.org (Better Business Bureau)
   - Manta.com
   - SuperPages.com
   - WhitePages.com
   - Extracts: Phone numbers, addresses, emails

3. **Regulatory/Government Filings** (Public Records)
   - OSHA.gov (safety contacts)
   - EPA.gov (environmental contacts)
   - Extracts: Safety managers, compliance contacts

4. **Industry Directories**
   - ThomasNet.com
   - IndustryNet.com
   - Extracts: Facility managers, purchasing contacts

5. **Company Websites**
   - "Contact Us" pages
   - "Our Team" pages
   - "Staff Directory" pages
   - Extracts: Names, titles, phones, emails

**Returns:**
- Contact names with job titles
- Direct phone numbers
- Email addresses
- Department classification
- Source URL for verification

**Extraction Patterns:**
- Name + Title: "John Smith, Plant Manager"
- Title + Name: "Plant Manager: John Smith"
- Contextual phone/email matching (within 300 characters)

**Target Titles:**
- Plant Manager
- Site Manager
- Facility Manager
- Safety Manager / EHS Manager
- Maintenance Manager
- Operations Manager
- Production Manager
- Safety Director
- Operations Director
- Facilities Director

**Compliance Features:**
- Respects `robots.txt` for all domains
- 2-second rate limiting between requests
- Identifies bot with proper User-Agent
- Only accesses publicly available pages
- Deduplicates results
- Limits to top 15 pages per search

**Local vs HQ Distinction:** YES - Search queries include city/state/ZIP, prioritizes local results

**Configuration:**
```javascript
const { findContactsViaWebScraping } = require('./leads/webScraperEnhanced');

const result = await findContactsViaWebScraping({
  companyName: "Target Corporation",
  city: "Minneapolis",
  state: "MN",
  postalCode: "55403",
  addressHint: "1000 Nicollet Mall"
});

// Returns: { ok, contacts[], source, scrapedPages, message }
```

---

### **Tier 5: Local Business Intelligence** (HQ vs Local Classification)
**Source:** `leads/localBusinessIntel.js`
**Purpose:** Distinguish headquarters contacts from local facility contacts

**Classification Signals:**

**HQ Indicators (+score):**
- Address contains: "headquarters", "HQ", "corporate", "main office"
- Phone is toll-free: 1-800, 1-844, 1-855, etc.
- Title contains: "Chief", "CEO", "CFO", "VP", "Corporate"

**Local Indicators (+score):**
- Address contains: "plant", "facility", "site", "branch", "location"
- ZIP code exact match with invoice (+5 pts)
- City/state match with invoice (+3 pts)
- Title contains: "Site Manager", "Plant Manager", "Facility Manager", "Local"

**Usage:**
```javascript
const { prioritizeLocalContacts, enhanceContactWithLocationData } = require('./leads/localBusinessIntel');

// Classify and sort contacts (local first, HQ last)
const sorted = prioritizeLocalContacts(contacts, invoiceAddress);

// Or enhance individual contact
const enhanced = enhanceContactWithLocationData(contact, invoiceAddress);
// Returns: { ...contact, locationClassification, locationConfidence, isLocalFacility, isHeadquarters }
```

---

## Integration into Existing System

### Current Implementation
File: `server.js:713-780`

```javascript
async function findLeadsForAccount({ accountName, postalCode, allowPublic, publicTimeoutMs }) {
  // Tier 1: ZoomInfo CSV
  if (contacts.length) {
    const candidates = contacts.filter(/* name + ZIP match */);
    if (candidates.length > 0) {
      return { ok: true, source: "zoominfo", leads: scored };
    }
  }

  // Tier 2: Google Places API
  const publicLeads = await findPublicLeads(accountName, zip);
  if (publicLeads.length) {
    return { ok: true, source: "public_web", leads: publicLeads };
  }

  // Tier 3: OpenStreetMap
  const osm = await findOsmPhoneAndName({ accountName, postalCode, addressHint });
  if (osm && osm.phone) {
    return { ok: true, source: "osm_public", leads: [osmLead] };
  }

  return { ok: false, source: "public_web", leads: [], message: "No leads found" };
}
```

### Recommended Enhancement
Add Tier 4 (Web Scraping) between Tier 3 and failure:

```javascript
// After Tier 3 OSM fails, before returning empty

// Tier 4: Web Scraping (comprehensive public sources)
try {
  const { findContactsViaWebScraping } = require('./leads/webScraperEnhanced');
  const { prioritizeLocalContacts } = require('./leads/localBusinessIntel');

  const webResult = await findContactsViaWebScraping({
    companyName: accountName,
    city: /* extract from addressHint or invoice */,
    state: /* extract from addressHint or invoice */,
    postalCode: zip,
    addressHint: addressHint
  });

  if (webResult.ok && webResult.contacts.length > 0) {
    // Classify contacts as local vs HQ
    const prioritized = prioritizeLocalContacts(webResult.contacts, {
      postalCode: zip,
      city: /* city */,
      state: /* state */
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
      city: c.city || "",
      state: c.state || "",
      postalCode: c.postalCode || zip,
      score: scoreContact(c),
      source: c.source,
      isLocalFacility: c.isLocalFacility || false,
      locationConfidence: c.locationConfidence || 0
    }));

    return { ok: true, source: "web_scraper", leads };
  }
} catch (err) {
  console.warn("[LEADS] Tier 4 web scraping failed:", err.message);
}

// Only return empty if ALL tiers fail
return { ok: false, source: "public_web", leads: [], message: "No leads found" };
```

---

## Dependencies

### Required npm packages:
```bash
npm install node-fetch jsdom
```

### Optional (for enhanced features):
```bash
npm install cheerio  # Alternative to JSDOM (faster)
npm install puppeteer  # For JavaScript-heavy sites (use sparingly)
```

---

## Legal & Ethical Compliance

### ✅ Legal Practices
1. **Public Data Only**: All scraped data is publicly accessible without login
2. **robots.txt Compliance**: Respects all robots.txt directives
3. **Rate Limiting**: 2-second delays between requests
4. **Proper Identification**: Uses descriptive User-Agent
5. **No Login Required**: Never accesses password-protected content
6. **Government Data**: Uses public regulatory filings (OSHA, EPA)
7. **Business Directories**: Accesses data meant for public discovery
8. **LinkedIn Public Pages**: Only accesses company pages and public profiles (no login-required content)

### ❌ Prohibited Practices (NOT Implemented)
1. ❌ Login-required content scraping
2. ❌ CAPTCHA circumvention
3. ❌ Terms of Service violations
4. ❌ Personal data harvesting beyond business contacts
5. ❌ Excessive request rates (DDoS)
6. ❌ Misleading User-Agent strings

---

## Performance & Caching

### Current Caching
- **ZoomInfo**: Loaded once at startup
- **OSM**: In-memory cache with configurable TTL
- **Leads**: 15-minute cache per account+ZIP combination

### Recommended Enhancements
1. **Web Scraper Cache**: Store scraped contacts in database for 30 days
2. **Failed Lookup Cache**: Remember failed searches to avoid retries
3. **Persistent Storage**: Save scraped data to `storage/leads/` for audit trail

---

## Configuration Summary

### Environment Variables
```bash
# Tier 2: Google Places
GOOGLE_PLACES_API_KEY=your_key_here

# Tier 3: OpenStreetMap
OSM_ENABLE=1
OSM_ZIPFIRST_TIMEOUT_MS=4000
OSM_NOMINATIM_TIMEOUT_MS=6000
OSM_OVERPASS_TIMEOUT_MS=7000
OSM_OVERPASS_RADIUS_M=120

# Tier 4: Web Scraper
WEB_SCRAPER_ENABLE=1                # Enable/disable web scraping
WEB_SCRAPER_RATE_LIMIT_MS=2000      # Delay between requests
WEB_SCRAPER_MAX_PAGES=15            # Max pages to scrape per search
WEB_SCRAPER_TIMEOUT_MS=8000         # Timeout per page
```

### Data Files
```
/Users/taylorray/Desktop/ai-sales-backend/
├── zoominfo-contacts.csv           # Tier 1: Proprietary contacts
├── leads/
│   ├── webScraper.js              # Tier 4: Basic scraper
│   ├── webScraperEnhanced.js      # Tier 4: Enhanced with LinkedIn
│   └── localBusinessIntel.js       # Tier 5: HQ vs Local classification
└── storage/
    └── leads/                      # Cached/scraped contact data
```

---

## Success Metrics

### Tier Performance Goals
| Tier | Hit Rate | Avg Contacts | Avg Latency |
|------|----------|--------------|-------------|
| Tier 1 (ZoomInfo) | 60-80% | 3-5 | <50ms |
| Tier 2 (Google) | 40-60% | 1-2 | 1-2s |
| Tier 3 (OSM) | 10-30% | 1 | 4-10s |
| Tier 4 (Web) | 30-50% | 2-6 | 10-30s |

### Quality Metrics
- **Local Facility Match**: >80% of contacts should be local (not HQ)
- **Contact Reachability**: >70% of phone numbers should be valid
- **Title Relevance**: >60% should be decision-makers (Manager+ level)

---

## Testing

### Test Tier 4 Standalone
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
  console.log(JSON.stringify(result, null, 2));
})();
"
```

### Test Local Classification
```bash
node -e "
const { classifyLocation } = require('./leads/localBusinessIntel');
const contact = {
  contactName: 'John Smith',
  title: 'Plant Manager',
  postalCode: '55403',
  city: 'Minneapolis'
};
const invoice = { postalCode: '55403', city: 'Minneapolis' };
console.log(classifyLocation(contact, invoice));
"
```

---

## Next Steps

1. **Install Dependencies**
   ```bash
   npm install node-fetch jsdom
   ```

2. **Enable Tier 4 in server.js**
   - Add web scraper after OSM tier
   - Integrate local business intelligence

3. **Configure Environment**
   ```bash
   echo "WEB_SCRAPER_ENABLE=1" >> .env
   ```

4. **Test with Real Invoice**
   ```bash
   ./test-real-business.sh
   ```

5. **Monitor & Tune**
   - Check scraping success rate
   - Adjust rate limits if getting blocked
   - Fine-tune title/name extraction patterns

---

## Legal Disclaimer

This system is designed to operate within legal boundaries by:
- Only accessing publicly available data
- Respecting robots.txt and website terms
- Using reasonable rate limits
- Identifying itself properly
- Not circumventing access controls

However, website scraping laws vary by jurisdiction. Users should:
1. Review applicable laws in their jurisdiction
2. Ensure compliance with CFAA, GDPR, CCPA, etc.
3. Consult legal counsel if uncertain
4. Monitor for changes in website terms of service
5. Be prepared to disable scraping for specific domains if requested

The developers of this system are not responsible for misuse or legal violations by end users.
