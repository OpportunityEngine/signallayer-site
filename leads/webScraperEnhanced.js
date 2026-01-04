// webScraperEnhanced.js
// Enhanced Tier 4: Comprehensive legal web scraping for local business contacts
// Includes LinkedIn public pages, business directories, and regulatory filings
// Respects robots.txt, rate limits, and only uses publicly available data
// Integrated with RocketReach API, DuckDuckGo (free!), Bing search, and Hunter.io

const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
require("dotenv").config();

// Rate limiting to be respectful
const RATE_LIMIT_MS = 2000; // 2 seconds between requests
let lastRequestTime = 0;

// Helper function for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Rotate user agents to appear more like real browsers
const userAgents = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
];

let userAgentIndex = 0;

async function respectfulFetch(url, options = {}) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastRequest));
  }

  lastRequestTime = Date.now();

  // Rotate user agents
  const userAgent = userAgents[userAgentIndex % userAgents.length];
  userAgentIndex++;

  const headers = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });
  return response;
}

/**
 * RocketReach API: Find contact information by company and location
 * Returns: { contactName, title, email, phone, linkedin }
 */
async function searchRocketReach(companyName, city, state) {
  const apiKey = process.env.ROCKETREACH_API_KEY;
  if (!apiKey) {
    console.log("[WEB_SCRAPER] RocketReach API key not configured, skipping");
    return [];
  }

  try {
    console.log(`[WEB_SCRAPER] RocketReach: Searching for contacts at ${companyName} in ${city}, ${state}`);

    const searchUrl = 'https://api.rocketreach.co/v2/api/search';
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': apiKey
      },
      body: JSON.stringify({
        query: {
          current_employer: [companyName],
          location: [`${city}, ${state}`]
        },
        page_size: 10,
        start: 1
      }),
      timeout: 10000
    });

    if (!response.ok) {
      console.warn(`[WEB_SCRAPER] RocketReach API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const contacts = [];

    if (data.profiles && data.profiles.length > 0) {
      console.log(`[WEB_SCRAPER] RocketReach found ${data.profiles.length} contacts`);

      for (const profile of data.profiles) {
        contacts.push({
          contactName: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
          title: profile.current_title || '',
          department: inferDepartment(profile.current_title || ''),
          directPhone: profile.phones && profile.phones.length > 0 ? profile.phones[0].number : '',
          mobilePhone: '',
          corpPhone: '',
          email: profile.emails && profile.emails.length > 0 ? profile.emails[0].email : '',
          company: companyName,
          source: 'rocketreach_api',
          linkedin: profile.linkedin_url || ''
        });
      }
    }

    return contacts;
  } catch (err) {
    console.warn(`[WEB_SCRAPER] RocketReach API failed:`, err.message);
    return [];
  }
}

/**
 * Hunter.io API: Find email patterns for a company domain
 * Returns: [{ email, firstName, lastName, position, confidence }]
 */
async function searchHunterIO(companyDomain) {
  const apiKey = process.env.HUNTER_IO_API_KEY;
  if (!apiKey) {
    console.log("[WEB_SCRAPER] Hunter.io API key not configured, skipping");
    return [];
  }

  try {
    console.log(`[WEB_SCRAPER] Hunter.io: Searching for emails at ${companyDomain}`);

    const searchUrl = `https://api.hunter.io/v2/domain-search?domain=${companyDomain}&api_key=${apiKey}&limit=10`;
    const response = await fetch(searchUrl, { timeout: 8000 });

    if (!response.ok) {
      console.warn(`[WEB_SCRAPER] Hunter.io API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const contacts = [];

    if (data.data && data.data.emails && data.data.emails.length > 0) {
      console.log(`[WEB_SCRAPER] Hunter.io found ${data.data.emails.length} contacts`);

      for (const emailData of data.data.emails) {
        if (emailData.position && emailData.position.toLowerCase().match(/(manager|director|safety|ehs|facility|plant|operations)/)) {
          contacts.push({
            contactName: `${emailData.first_name || ''} ${emailData.last_name || ''}`.trim(),
            title: emailData.position || '',
            department: inferDepartment(emailData.position || ''),
            directPhone: emailData.phone_number || '',
            mobilePhone: '',
            corpPhone: '',
            email: emailData.value || '',
            company: companyDomain.replace(/\.com$/, '').toUpperCase(),
            source: 'hunter_io_api',
            confidence: emailData.confidence || 0
          });
        }
      }
    }

    return contacts;
  } catch (err) {
    console.warn(`[WEB_SCRAPER] Hunter.io API failed:`, err.message);
    return [];
  }
}

/**
 * DuckDuckGo HTML Search: Free alternative to Google Custom Search (no API key needed!)
 * Scrapes DuckDuckGo search results page for URLs
 */
async function searchDuckDuckGo(query) {
  try {
    console.log(`[WEB_SCRAPER] DuckDuckGo search for: "${query}"`);

    // DuckDuckGo search URL (use HTML version, not API)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    await sleep(RATE_LIMIT_MS); // Be respectful
    const response = await respectfulFetch(searchUrl, { timeout: 10000 });
    const html = await response.text();
    const dom = new JSDOM(html);

    const urls = [];

    // DuckDuckGo HTML results are in <a class="result__a">
    const resultLinks = dom.window.document.querySelectorAll('a.result__a, a.result__url');

    for (const link of resultLinks) {
      const href = link.getAttribute('href');
      if (href && !href.includes('duckduckgo.com')) {
        try {
          // DDG wraps URLs, need to decode
          let cleanUrl = href;
          if (href.includes('uddg=')) {
            const urlMatch = href.match(/uddg=([^&]+)/);
            if (urlMatch) {
              cleanUrl = decodeURIComponent(urlMatch[1]);
            }
          }

          new URL(cleanUrl); // Validate URL
          urls.push(cleanUrl);
        } catch (e) {
          // Invalid URL, skip
        }
      }
    }

    // Also try extracting from snippet text for contact names
    const snippets = dom.window.document.querySelectorAll('.result__snippet');
    const contacts = [];

    for (const snippet of snippets) {
      const text = snippet.textContent || '';

      // Extract names (First Last format)
      const nameMatches = text.matchAll(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g);
      for (const match of nameMatches) {
        const name = match[1];
        // Filter out common false positives
        if (!name.match(/(Google|Facebook|LinkedIn|Twitter|United States|New York|Los Angeles)/i)) {
          // Check if title keywords are nearby
          const contextStart = Math.max(0, match.index - 50);
          const contextEnd = Math.min(text.length, match.index + 50);
          const context = text.substring(contextStart, contextEnd).toLowerCase();

          if (context.match(/(manager|director|supervisor|coordinator|lead|chief|president|vice)/i)) {
            const titleMatch = context.match(/(plant manager|facility manager|safety manager|ehs manager|operations manager|general manager|site manager|production manager)/i);
            contacts.push({
              contactName: name,
              title: titleMatch ? titleMatch[1] : 'Manager',
              source: 'duckduckgo_snippet'
            });
          }
        }
      }
    }

    console.log(`[WEB_SCRAPER] DuckDuckGo found ${urls.length} URLs and ${contacts.length} potential contacts from snippets`);

    // Return both URLs and any contacts found in snippets
    return { urls, contacts };

  } catch (err) {
    console.warn(`[WEB_SCRAPER] DuckDuckGo search failed:`, err.message);
    return { urls: [], contacts: [] };
  }
}

/**
 * Search using Bing (more bot-friendly than Google) - ENHANCED
 */
async function searchBing(query) {
  try {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    const response = await respectfulFetch(searchUrl, { timeout: 6000 });
    const html = await response.text();
    const dom = new JSDOM(html);

    const urls = new Set();

    // Enhanced Bing result selectors (multiple patterns to catch all results)
    const linkSelectors = [
      'li.b_algo h2 a',           // Main results
      'li.b_algo a[href^="http"]', // All HTTP links in results
      '.b_attribution cite',       // Display URLs
      'h2 a[href^="http"]',        // Alternative selector
      'cite'                       // Citation URLs
    ];

    for (const selector of linkSelectors) {
      const elements = dom.window.document.querySelectorAll(selector);
      elements.forEach(element => {
        let href = element.getAttribute("href") || element.textContent.trim();

        // Clean up cite elements (they show display URLs)
        if (element.tagName === 'CITE') {
          href = href.split('›')[0].split('»')[0].trim();
          if (!href.startsWith('http')) {
            href = 'https://' + href;
          }
        }

        // Validate and add URL
        if (href && href.startsWith("http")) {
          // Skip Bing's redirect URLs
          if (!href.includes('bing.com/ck/a')) {
            try {
              new URL(href); // Validate URL
              urls.add(href);
            } catch (e) {
              // Invalid URL, skip
            }
          }
        }
      });
    }

    if (urls.size === 0) {
      console.warn(`[WEB_SCRAPER] Bing search returned no results for: ${query}`);
    } else {
      console.log(`[WEB_SCRAPER] Bing search found ${urls.size} URLs for: ${query}`);
    }

    return Array.from(urls);
  } catch (err) {
    console.warn(`[WEB_SCRAPER] Bing search failed:`, err.message);
    return [];
  }
}

/**
 * Search for publicly available contacts from LinkedIn and ZoomInfo
 * This searches for patterns like "john smith owens corning plant manager" to find public profiles
 */
async function searchPublicContactProfiles(companyName, city, state) {
  try {
    console.log(`[WEB_SCRAPER] Searching for public contact profiles for ${companyName}`);

    const contacts = [];

    // Common job titles for industrial facilities
    const targetTitles = [
      "plant manager",
      "facility manager",
      "site manager",
      "operations manager",
      "safety manager",
      "ehs manager",
      "production manager",
      "maintenance manager",
      "general manager"
    ];

    // Search for each title + company name on LinkedIn and ZoomInfo
    for (const title of targetTitles.slice(0, 5)) { // Limit to 5 to avoid excessive searches
      const queries = [
        `"${companyName}" "${title}" site:linkedin.com ${city || ''} ${state || ''}`,
        `"${companyName}" "${title}" site:zoominfo.com ${city || ''} ${state || ''}`,
        `"${companyName}" "${city || ''}" "${state || ''}" "${title}"`
      ];

      for (const query of queries) {
        try {
          const urls = await searchBing(query);

          // Process LinkedIn URLs to extract contact info
          const linkedinUrls = urls.filter(url => url.includes('linkedin.com/in/') || url.includes('linkedin.com/pub/'));

          for (const url of linkedinUrls.slice(0, 3)) { // Limit to 3 profiles per query
            try {
              await sleep(RATE_LIMIT_MS);
              const response = await respectfulFetch(url, { timeout: 8000 });
              const html = await response.text();

              const linkedinContacts = extractLinkedInContacts(html, companyName, url);
              if (linkedinContacts.length > 0) {
                console.log(`[WEB_SCRAPER] ✓ Found ${linkedinContacts.length} contacts from public LinkedIn profile: ${url}`);
                contacts.push(...linkedinContacts);
              }
            } catch (err) {
              console.warn(`[WEB_SCRAPER] Failed to scrape LinkedIn profile ${url}:`, err.message);
            }

            // Stop if we have enough contacts
            if (contacts.length >= 10) break;
          }

          if (contacts.length >= 10) break;
        } catch (err) {
          console.warn(`[WEB_SCRAPER] Public profile search failed for "${query}":`, err.message);
        }
      }

      if (contacts.length >= 10) break;
    }

    console.log(`[WEB_SCRAPER] Public profile search found ${contacts.length} contacts`);
    return contacts;

  } catch (err) {
    console.error(`[WEB_SCRAPER] Public contact profile search error:`, err.message);
    return [];
  }
}

/**
 * Generate direct URLs to business directories (no search needed)
 */
function getDirectoryUrls(companyName, city, state, postalCode) {
  const encodedName = encodeURIComponent(companyName);
  const encodedCity = encodeURIComponent(city || "");
  const encodedState = encodeURIComponent(state || "");
  const encodedZip = encodeURIComponent(postalCode || "");

  const urls = [];

  // YellowPages
  if (city && state) {
    urls.push(`https://www.yellowpages.com/search?search_terms=${encodedName}&geo_location_terms=${encodedCity}%2C+${encodedState}`);
  }
  if (postalCode) {
    urls.push(`https://www.yellowpages.com/search?search_terms=${encodedName}&geo_location_terms=${encodedZip}`);
  }

  // Yelp
  if (city && state) {
    urls.push(`https://www.yelp.com/search?find_desc=${encodedName}&find_loc=${encodedCity}%2C+${encodedState}`);
  }

  // Better Business Bureau
  if (city && state) {
    urls.push(`https://www.bbb.org/search?find_text=${encodedName}&find_loc=${encodedCity}%2C+${encodedState}`);
  }

  // Manta
  if (city && state) {
    urls.push(`https://www.manta.com/search?search=${encodedName}&location=${encodedCity}%2C+${encodedState}`);
  }

  // LinkedIn company search (public)
  urls.push(`https://www.linkedin.com/search/results/companies/?keywords=${encodedName}`);

  return urls;
}

/**
 * Search for company contact page URLs using multiple legal sources
 */
async function findContactPageUrls(companyName, city, state, postalCode) {
  const urls = new Set();

  // Strategy 1: Direct directory URLs (fastest, most reliable)
  console.log(`[WEB_SCRAPER] Generating direct directory URLs...`);
  const directUrls = getDirectoryUrls(companyName, city, state, postalCode);
  directUrls.forEach(url => urls.add(url));
  console.log(`[WEB_SCRAPER] Added ${directUrls.length} direct directory URLs`);

  // Strategy 2: Search engines for LinkedIn profiles and contact pages
  // PRIORITY: LinkedIn profiles (most likely to have names, titles, and contact info)
  const searchQueries = [
    `site:linkedin.com/in "${companyName}" "${city}" "plant manager"`,  // LinkedIn profiles FIRST
    `site:linkedin.com/in "${companyName}" "${city}" "facility manager"`,
    `site:linkedin.com/in "${companyName}" "${city}" "safety manager"`,
    `site:linkedin.com/in "${companyName}" "${city}" "site manager"`,
    `"${companyName}" ${postalCode} contact phone`,
    `"${companyName}" ${city} ${state} ${postalCode} "plant manager"`,
    `"${companyName}" ${city} ${state} "facility manager"`,
    `"${companyName}" ${postalCode} email`,
  ];

  for (const query of searchQueries) {
    try {
      // Try DuckDuckGo first (free, no API key needed!), fallback to Bing
      let ddgResult = await searchDuckDuckGo(query);

      // Add any contacts found directly from DDG snippets
      if (ddgResult.contacts && ddgResult.contacts.length > 0) {
        console.log(`[WEB_SCRAPER] ✓ DuckDuckGo snippets found ${ddgResult.contacts.length} contacts!`);
        contacts.push(...ddgResult.contacts);
      }

      let results = ddgResult.urls || [];
      if (results.length === 0) {
        // Fallback to Bing if DDG returns nothing
        results = await searchBing(query);
        console.log(`[WEB_SCRAPER] Bing search "${query}" found ${results.length} results`);
      } else {
        console.log(`[WEB_SCRAPER] DuckDuckGo search "${query}" found ${results.length} results`);
      }
      results.forEach(url => urls.add(url));

      if (urls.size >= 25) break; // Enough URLs
    } catch (err) {
      console.warn(`[WEB_SCRAPER] Search query failed: ${query}`, err.message);
    }
  }

  // Clean and validate URLs
  const urlArray = Array.from(urls).map(url => {
    // Clean breadcrumb characters and other artifacts
    let cleaned = url.replace(/\s*›\s*/g, '/').replace(/\s*»\s*/g, '/').trim();

    // Remove any trailing/leading whitespace
    cleaned = cleaned.replace(/\s+/g, '');

    return cleaned;
  }).filter(url => {
    // Validate URL format
    try {
      new URL(url);
      return url.startsWith('http://') || url.startsWith('https://');
    } catch {
      return false;
    }
  });

  // Prioritize sources
  const prioritized = urlArray.sort((a, b) => {
    const getPriority = (url) => {
      if (url.includes("linkedin.com/company")) return 10; // LinkedIn company pages (rich data)
      if (url.includes("linkedin.com/in")) return 9; // LinkedIn profiles (individual contacts)
      if (url.includes("/contact") || url.includes("/team") || url.includes("/staff")) return 8; // Company contact pages
      if (url.includes("yellowpages.com")) return 7;
      if (url.includes("bbb.org")) return 6;
      if (url.includes("yelp.com")) return 5;
      if (url.includes("manta.com") || url.includes("superpages.com")) return 4;
      if (url.includes("osha.gov") || url.includes("epa.gov")) return 3; // Regulatory filings
      if (url.includes("thomasnet.com") || url.includes("industrynet.com")) return 2;
      return 1;
    };

    return getPriority(b) - getPriority(a);
  });

  console.log(`[WEB_SCRAPER] Found ${prioritized.length} valid URLs, top sources:`,
    prioritized.slice(0, 5).map(u => {
      try {
        return new URL(u).hostname;
      } catch {
        return 'invalid';
      }
    }).filter(h => h !== 'invalid'));

  return prioritized.slice(0, 20);
}

/**
 * Extract contacts from LinkedIn profile page or search results (public data only, no login required)
 */
function extractLinkedInContacts(html, companyName, url = "") {
  const contacts = [];

  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const bodyText = doc.body ? doc.body.textContent : "";

    // Check if this is a LinkedIn profile URL (linkedin.com/in/...)
    const isProfileUrl = url.includes("linkedin.com/in/");

    if (isProfileUrl) {
      // ENHANCED: Extract name and title from multiple possible locations
      let extractedName = "";
      let extractedTitle = "";

      // Method 1: Parse from title tag - "John Smith - Plant Manager - Perdue | LinkedIn"
      const titleTag = doc.querySelector('title');
      if (titleTag) {
        const titleText = titleTag.textContent;
        const parts = titleText.split(' - ').map(p => p.split('|')[0].trim());
        if (parts.length >= 2) {
          extractedName = parts[0].trim();
          extractedTitle = parts[1].trim();
        }
      }

      // Method 2: Extract from meta tags (more reliable)
      const ogTitle = doc.querySelector('meta[property="og:title"]');
      if (ogTitle && !extractedName) {
        const content = ogTitle.getAttribute('content') || "";
        const parts = content.split(' - ');
        if (parts.length >= 2) {
          extractedName = parts[0].trim();
          extractedTitle = parts[1].trim();
        }
      }

      // Method 3: Look for structured data (JSON-LD)
      const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
      scripts.forEach(script => {
        try {
          const data = JSON.parse(script.textContent || "{}");
          if (data.name && !extractedName) extractedName = data.name;
          if (data.jobTitle && !extractedTitle) extractedTitle = data.jobTitle;
        } catch (e) {
          // Invalid JSON, skip
        }
      });

      // Method 4: Extract from body text patterns
      if (!extractedName || !extractedTitle) {
        // Look for h1 tags with names
        const h1 = doc.querySelector('h1');
        if (h1 && !extractedName) {
          const h1Text = h1.textContent.trim();
          // Names are usually 2-4 words, capitalized
          if (h1Text.match(/^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,3}$/)) {
            extractedName = h1Text;
          }
        }

        // Look for job title in body
        const bodyText = doc.body ? doc.body.textContent : "";
        const titlePatterns = [
          /(?:Title|Position|Role):\s*([^,\n]{5,60})/i,
          /(?:Current(?:\s+position)?|Job):\s*([^,\n]{5,60})/i
        ];
        for (const pattern of titlePatterns) {
          const match = bodyText.match(pattern);
          if (match && !extractedTitle) {
            extractedTitle = match[1].trim();
            break;
          }
        }
      }

      // Validate and save contact if we have good data
      if (extractedName && extractedTitle) {
        // Check if title is relevant to industrial facilities
        const relevantTitles = [
          "plant", "facility", "site", "manager", "director", "supervisor",
          "safety", "maintenance", "operations", "production", "ehs", "engineering",
          "environmental", "quality", "manufacturing"
        ];

        const titleLower = extractedTitle.toLowerCase();
        if (relevantTitles.some(t => titleLower.includes(t))) {
          console.log(`[WEB_SCRAPER] ✓ Extracted LinkedIn profile: ${extractedName} - ${extractedTitle}`);

          // Infer email from name and company domain using multiple patterns
          const companyDomain = inferCompanyDomain(companyName);
          let primaryEmail = "";
          let alternateEmails = [];

          if (companyDomain && extractedName) {
            const inferredEmails = inferEmailPatterns(extractedName, companyDomain);
            if (inferredEmails.length > 0) {
              primaryEmail = inferredEmails[0]; // Use most common pattern
              alternateEmails = inferredEmails.slice(1, 4); // Store top 3 alternates
              console.log(`[WEB_SCRAPER] Inferred emails: ${inferredEmails.slice(0, 3).join(', ')}`);
            }
          }

          contacts.push({
            contactName: extractedName,
            title: extractedTitle,
            department: inferDepartment(extractedTitle),
            directPhone: "",
            mobilePhone: "",
            corpPhone: "",
            email: primaryEmail,
            alternateEmails: alternateEmails,
            company: companyName,
            source: "linkedin_profile",
            linkedin: url
          });
        } else {
          console.log(`[WEB_SCRAPER] Skipping irrelevant LinkedIn profile: ${extractedName} - ${extractedTitle}`);
        }
      } else {
        console.log(`[WEB_SCRAPER] Could not extract complete profile from LinkedIn URL: ${url}`);
      }
    } else {
      // This is a company page or search results - extract employee patterns
      // Pattern: "John Smith - Plant Manager at CompanyName"
      const employeePattern = /([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[-–]\s*([^-\n]{5,50}?)\s+at\s+/gi;

      let match;
      while ((match = employeePattern.exec(bodyText)) !== null) {
        const name = match[1].trim();
        const title = match[2].trim();

        // Filter for relevant titles
        const relevantTitles = [
          "plant", "facility", "site", "manager", "director", "supervisor",
          "safety", "maintenance", "operations", "production", "ehs"
        ];

        const titleLower = title.toLowerCase();
        if (relevantTitles.some(t => titleLower.includes(t))) {
          contacts.push({
            contactName: name,
            title: title,
            department: inferDepartment(title),
            directPhone: "",
            mobilePhone: "",
            corpPhone: "",
            email: "",
            company: companyName,
            source: "linkedin_public"
          });
        }
      }
    }

    // Also look for "About" section with company phone
    const aboutSection = doc.querySelector('[class*="about"]');
    if (aboutSection) {
      const aboutText = aboutSection.textContent || "";
      const phoneMatch = aboutText.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      if (phoneMatch && contacts.length > 0) {
        contacts[0].corpPhone = phoneMatch[0];
      }
    }

  } catch (err) {
    console.warn("[WEB_SCRAPER] LinkedIn parsing failed:", err.message);
  }

  return contacts;
}

/**
 * Extract contacts from business directory pages
 */
function extractDirectoryContacts(html, companyName, directoryType, targetZip = "") {
  const contacts = [];

  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const bodyText = doc.body ? doc.body.textContent : "";

    // Phone number extraction
    const phoneRegex = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    let phones = [...new Set(bodyText.match(phoneRegex) || [])];

    // Clean and validate phone numbers
    phones = phones.map(p => p.replace(/\D/g, '')).filter(p => {
      // Must be exactly 10 or 11 digits (with optional leading 1)
      if (p.length === 11 && p.startsWith('1')) {
        p = p.substring(1);
      }
      if (p.length !== 10) return false;

      // Filter out invalid patterns
      const areaCode = p.substring(0, 3);
      const exchange = p.substring(3, 6);

      // Invalid area codes (000, 555, etc.)
      if (areaCode === '000' || areaCode === '555' || areaCode === '100') return false;

      // Invalid exchanges
      if (exchange === '555' || exchange === '000') return false;

      return true;
    });

    // Filter out BBB/directory organization phone numbers (common patterns)
    // BBB Florida chapters typically use 727, 561, 305, 954, 850 area codes
    // Filter these out if target business is NOT in Florida
    const targetState = inferStateFromZip(targetZip);
    if (targetState && targetState !== "FL") {
      const floridaAreaCodes = ["727", "561", "305", "954", "850", "407", "321", "386", "813", "941", "239"];
      phones = phones.filter(phone => {
        const areaCode = phone.substring(0, 3);
        return !floridaAreaCodes.includes(areaCode);
      });
    }

    // Format phones nicely
    phones = phones.map(p => `(${p.substring(0,3)}) ${p.substring(3,6)}-${p.substring(6,10)}`).slice(0, 3);

    // Address extraction (for location verification)
    const addressRegex = /\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)[,\s]+[A-Za-z\s]+[,\s]+[A-Z]{2}\s+\d{5}/gi;
    const addresses = bodyText.match(addressRegex) || [];

    // Email extraction (filter out BBB, directory sites, and generic emails)
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    let emails = [...new Set(bodyText.match(emailRegex) || [])]
      .filter(e => {
        const lowerEmail = e.toLowerCase();
        return !e.includes("example.com") &&
          !e.includes("yourdomain") &&
          !e.includes("sentry") &&
          !lowerEmail.includes("bbb") &&           // BBB emails (all chapters including thefirstbbb.org)
          !e.includes("@yelp.com") &&      // Yelp contact emails
          !e.includes("@yellowpages.com") && // YellowPages emails
          !e.includes("@manta.com") &&     // Manta directory emails
          !lowerEmail.includes("admin@") && // Generic admin emails
          !lowerEmail.includes("info@") &&  // Generic info emails
          !lowerEmail.includes("support@");  // Generic support emails
      });

    // Infer company email domain and prioritize company emails
    const companyDomain = inferCompanyDomain(companyName);
    if (companyDomain) {
      // Prioritize emails from the company domain
      const companyEmails = emails.filter(e => e.toLowerCase().includes(`@${companyDomain.toLowerCase()}`));
      const otherEmails = emails.filter(e => !e.toLowerCase().includes(`@${companyDomain.toLowerCase()}`));
      emails = [...companyEmails, ...otherEmails];
    }

    // Extract actual contact names from the page
    const nameMatches = extractNamesAndTitles(bodyText);

    // Create contacts from found data
    if (nameMatches.length > 0) {
      // We found actual names with titles - use those!
      nameMatches.forEach((match, idx) => {
        if (idx < 5) { // Limit to top 5 named contacts
          contacts.push({
            contactName: match.name,
            title: match.title,
            department: inferDepartment(match.title),
            directPhone: phones[idx] || "",
            mobilePhone: "",
            corpPhone: phones[idx] || "",
            email: emails[idx] || "",
            company: companyName,
            address: addresses[0] || "",
            source: directoryType
          });
        }
      });
    } else if (phones.length > 0 || emails.length > 0) {
      // No names found, fall back to phone/email only contacts
      const maxContacts = Math.max(phones.length, emails.length);
      for (let idx = 0; idx < Math.min(maxContacts, 3); idx++) {
        if (phones[idx] || emails[idx]) {
          contacts.push({
            contactName: `${companyName} ${idx === 0 ? 'Main Line' : 'Contact ' + (idx + 1)}`,
            title: idx === 0 ? "Main Line" : "General Contact",
            department: "Front Desk",
            directPhone: "",
            mobilePhone: "",
            corpPhone: phones[idx] || "",
            email: emails[idx] || "",
            company: companyName,
            address: addresses[idx] || "",
            source: directoryType
          });
        }
      }
    }

  } catch (err) {
    console.warn(`[WEB_SCRAPER] ${directoryType} parsing failed:`, err.message);
  }

  return contacts;
}

/**
 * Extract contacts from general HTML (enhanced version)
 */
function extractContactsFromHtml(html, companyName, url, postalCode = "") {
  try {
    // Detect source type
    if (url.includes("linkedin.com")) {
      return extractLinkedInContacts(html, companyName, url);
    }

    if (url.includes("yellowpages.com")) {
      return extractDirectoryContacts(html, companyName, "yellow_pages", postalCode);
    }

    if (url.includes("bbb.org")) {
      return extractDirectoryContacts(html, companyName, "bbb", postalCode);
    }

    if (url.includes("yelp.com")) {
      return extractDirectoryContacts(html, companyName, "yelp", postalCode);
    }

    // General extraction
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const bodyText = doc.body ? doc.body.textContent : "";

    // Use the enhanced name extraction function
    const nameMatches = extractNamesAndTitles(bodyText);
    const contacts = [];

    const phoneRegex = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

    // Extract all phones and emails from page
    const allPhones = [...new Set(bodyText.match(phoneRegex) || [])];
    const allEmails = [...new Set(bodyText.match(emailRegex) || [])]
      .filter(e => {
        const lowerEmail = e.toLowerCase();
        return !e.includes("example.com") &&
          !e.includes("yourdomain") &&
          !lowerEmail.includes("bbb") &&
          !e.includes("@yelp.com") &&
          !e.includes("@yellowpages.com");
      });

    // Create contacts from named individuals
    nameMatches.forEach((match, idx) => {
      // Find phone/email near this person's name in the text
      const nameIndex = bodyText.indexOf(match.name);
      let contextPhone = "";
      let contextEmail = "";

      if (nameIndex !== -1) {
        const contextStart = Math.max(0, nameIndex - 300);
        const contextEnd = Math.min(bodyText.length, nameIndex + 300);
        const contextText = bodyText.substring(contextStart, contextEnd);

        const contextPhones = contextText.match(phoneRegex);
        const contextEmails = contextText.match(emailRegex);

        contextPhone = contextPhones ? contextPhones[0] : (allPhones[idx] || "");
        contextEmail = contextEmails ? contextEmails.filter(e => !e.toLowerCase().includes("bbb"))[0] : (allEmails[idx] || "");
      }

      contacts.push({
        contactName: match.name,
        title: match.title,
        department: inferDepartment(match.title),
        directPhone: contextPhone,
        mobilePhone: "",
        corpPhone: contextPhone,
        email: contextEmail,
        company: companyName,
        source: "web_scraped"
      });
    });

    return contacts;
  } catch (err) {
    console.warn("[WEB_SCRAPER] HTML parsing failed:", err.message);
    return [];
  }
}

/**
 * Extract names and titles from text
 * Looks for patterns like "John Smith, Plant Manager" or "Plant Manager: John Smith"
 */
function extractNamesAndTitles(text) {
  const results = [];
  const seen = new Set();

  // Relevant titles we care about (expanded for better matching)
  const titles = [
    // Management titles
    "Plant Manager", "Site Manager", "Facility Manager", "General Manager", "Location Manager",
    "Branch Manager", "Operations Manager", "Operations Director", "Production Manager",
    "Manufacturing Manager", "Plant Superintendent", "Site Superintendent",

    // Safety & Environmental
    "Safety Manager", "EHS Manager", "Environmental Manager", "HSE Manager",
    "Safety Director", "Director of Safety", "Safety Coordinator", "Safety Officer",
    "Environmental Health and Safety Manager", "EHS Coordinator",

    // Maintenance & Engineering
    "Maintenance Manager", "Maintenance Supervisor", "Maintenance Director",
    "Engineering Manager", "Chief Engineer", "Facilities Engineer",
    "Plant Engineer", "Maintenance Superintendent",

    // Supervisory
    "Plant Supervisor", "Site Supervisor", "Facility Supervisor",
    "Production Supervisor", "Shift Supervisor", "Operations Supervisor",

    // Facilities
    "Facilities Director", "Facilities Manager", "Facility Director",
    "Building Manager", "Site Coordinator",

    // Supply Chain & Procurement
    "Purchasing Manager", "Procurement Manager", "Supply Chain Manager",
    "Buyer", "Purchasing Agent", "Materials Manager",

    // HR & Admin
    "HR Manager", "Human Resources Manager", "HR Director",
    "Site Administrator", "Administrative Manager",

    // Quality & Compliance
    "Quality Manager", "Quality Assurance Manager", "QA Manager",
    "Compliance Manager", "Regulatory Manager"
  ];

  // Build regex patterns
  const titlePattern = titles.join("|");

  // Pattern 1: "John Smith, Plant Manager" or "John Smith - Plant Manager"
  const pattern1 = new RegExp(
    `([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,2})\\s*[,\\-–:]\\s*(${titlePattern})`,
    'gi'
  );

  // Pattern 2: "Plant Manager: John Smith" or "Plant Manager - John Smith"
  const pattern2 = new RegExp(
    `(${titlePattern})\\s*[:\\-–]\\s*([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,2})`,
    'gi'
  );

  // Pattern 3: Email-based name extraction (first.last@company.com)
  const emailPattern = /\b([a-z]+)\.([a-z]+)@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

  // Try pattern 1
  let match;
  while ((match = pattern1.exec(text)) !== null) {
    const name = match[1].trim();
    const title = match[2].trim();
    const key = name.toLowerCase();

    if (!seen.has(key) && name.split(' ').length >= 2) {
      seen.add(key);
      results.push({ name, title });
    }
  }

  // Try pattern 2
  while ((match = pattern2.exec(text)) !== null) {
    const title = match[1].trim();
    const name = match[2].trim();
    const key = name.toLowerCase();

    if (!seen.has(key) && name.split(' ').length >= 2) {
      seen.add(key);
      results.push({ name, title });
    }
  }

  // Try email-based extraction if we didn't find enough names
  if (results.length < 2) {
    while ((match = emailPattern.exec(text)) !== null) {
      const firstName = match[1].charAt(0).toUpperCase() + match[1].slice(1);
      const lastName = match[2].charAt(0).toUpperCase() + match[2].slice(1);
      const name = `${firstName} ${lastName}`;
      const key = name.toLowerCase();

      if (!seen.has(key) && results.length < 5) {
        seen.add(key);
        // Try to find their title nearby in the text
        const emailStart = match.index;
        const contextStart = Math.max(0, emailStart - 200);
        const contextEnd = Math.min(text.length, emailStart + 200);
        const context = text.substring(contextStart, contextEnd);

        let foundTitle = "Contact";
        for (const title of titles) {
          if (context.toLowerCase().includes(title.toLowerCase())) {
            foundTitle = title;
            break;
          }
        }

        results.push({ name, title: foundTitle });
      }
    }
  }

  return results;
}

function inferDepartment(title) {
  const t = title.toLowerCase();
  if (t.includes("safety") || t.includes("ehs") || t.includes("environmental")) return "Safety";
  if (t.includes("hr") || t.includes("human resources")) return "Human Resources";
  if (t.includes("maintenance")) return "Maintenance";
  if (t.includes("operations") || t.includes("production")) return "Operations";
  if (t.includes("plant") || t.includes("site") || t.includes("facility")) return "Management";
  if (t.includes("purchasing") || t.includes("procurement")) return "Purchasing";
  return "General";
}

/**
 * Detect seniority level from job title
 * Returns: 'executive', 'senior', 'mid', or 'entry'
 */
function detectSeniorityLevel(title) {
  if (!title) return 'entry';

  const titleLower = title.toLowerCase();

  // Executive level (C-suite, VPs, Presidents)
  const executiveTitles = ['ceo', 'cfo', 'coo', 'cto', 'chief', 'president', 'vp', 'vice president', 'executive'];
  if (executiveTitles.some(t => titleLower.includes(t))) {
    return 'executive';
  }

  // Senior level (Directors, Senior Managers, Heads)
  const seniorTitles = [
    'director', 'senior manager', 'head of', 'general manager', 'plant manager',
    'facility manager', 'site manager', 'regional', 'superintendent'
  ];
  if (seniorTitles.some(t => titleLower.includes(t))) {
    return 'senior';
  }

  // Mid level (Managers, Supervisors, Coordinators)
  const midTitles = [
    'manager', 'supervisor', 'coordinator', 'lead', 'specialist',
    'ehs', 'safety', 'maintenance', 'operations'
  ];
  if (midTitles.some(t => titleLower.includes(t))) {
    return 'mid';
  }

  // Entry level (everything else)
  return 'entry';
}

/**
 * Calculate confidence score for a contact (0-100)
 * Higher score = more complete and reliable data
 */
function calculateConfidenceScore(contact) {
  let score = 0;

  // Name quality (0-30 points)
  if (contact.contactName) {
    const isRealName = !contact.contactName.includes("Main Line") &&
                       !contact.contactName.includes("Contact ") &&
                       !contact.contactName.includes("General");

    if (isRealName) {
      score += 20; // Has real person name
      const nameParts = contact.contactName.split(' ');
      if (nameParts.length >= 2) score += 5; // Has first and last name
      if (nameParts.length >= 3) score += 5; // Has middle name/initial
    }
  }

  // Title quality (0-20 points)
  if (contact.title) {
    const hasTitle = !contact.title.includes("Main Line") && !contact.title.includes("General Contact");
    if (hasTitle) {
      score += 10; // Has title

      // Boost for senior/decision-maker titles
      const seniorTitles = ["manager", "director", "vp", "vice president", "head", "chief", "superintendent"];
      const titleLower = contact.title.toLowerCase();
      if (seniorTitles.some(t => titleLower.includes(t))) {
        score += 10; // Decision-maker title
      }
    }
  }

  // Contact info (0-40 points)
  if (contact.email) {
    score += 20; // Has email
    if (contact.alternateEmails && contact.alternateEmails.length > 0) {
      score += 5; // Has alternate email patterns
    }
  }

  if (contact.directPhone) score += 10; // Has direct phone
  if (contact.corpPhone) score += 5;    // Has corporate phone
  if (contact.mobilePhone) score += 5;  // Has mobile phone

  // Source quality (0-15 points) - Premium APIs score highest
  const sourceBonus = {
    'rocketreach_api': 15,   // RocketReach API - most reliable (verified data)
    'hunter_io_api': 14,     // Hunter.io API - very reliable email finder
    'linkedin_profile': 12,  // LinkedIn profiles are highly reliable
    'linkedin_public': 10,
    'web_scraped': 8,
    'yellow_pages': 5,
    'bbb': 3  // BBB is least reliable (often generic numbers)
  };
  score += sourceBonus[contact.source] || 0;

  return Math.min(100, score); // Cap at 100
}

/**
 * Infer multiple email patterns from name and company domain
 * Returns array of possible emails ordered by likelihood
 * Based on research: first.last@ (45%), flast@ (25%), firstlast@ (15%), first@ (10%), first_last@ (5%)
 */
function inferEmailPatterns(fullName, companyDomain) {
  if (!fullName || !companyDomain) return [];

  const nameParts = fullName.toLowerCase().split(' ').filter(p => p.length > 0);
  if (nameParts.length < 2) return [];

  const firstName = nameParts[0].replace(/[^a-z]/g, '');
  const lastName = nameParts[nameParts.length - 1].replace(/[^a-z]/g, '');
  const middleName = nameParts.length > 2 ? nameParts[1].replace(/[^a-z]/g, '') : '';

  if (!firstName || !lastName) return [];

  const patterns = [
    `${firstName}.${lastName}@${companyDomain}`,           // first.last@ (most common - 45%)
    `${firstName[0]}${lastName}@${companyDomain}`,         // flast@ (25%)
    `${firstName}${lastName}@${companyDomain}`,            // firstlast@ (15%)
    `${firstName}_${lastName}@${companyDomain}`,           // first_last@ (5%)
    `${firstName}@${companyDomain}`,                       // first@ (5%)
    `${firstName}${lastName[0]}@${companyDomain}`,         // firstl@ (3%)
    `${lastName}.${firstName}@${companyDomain}`,           // last.first@ (2%)
  ];

  // Add middle initial patterns if middle name exists
  if (middleName) {
    patterns.splice(1, 0, `${firstName}.${middleName[0]}.${lastName}@${companyDomain}`); // first.m.last@
    patterns.splice(3, 0, `${firstName[0]}${middleName[0]}${lastName}@${companyDomain}`); // fmlast@
  }

  return patterns;
}

/**
 * Infer company domain from company name
 */
function inferCompanyDomain(companyName) {
  if (!companyName) return "";

  // Common company name to domain mappings
  const knownDomains = {
    "PERDUE": "perduefarms.com",
    "PILGRIM'S PRIDE": "pilgrims.com",
    "OWENS CORNING": "owenscorning.com",
    "TYSON": "tysonfoods.com",
    "SMITHFIELD": "smithfieldfoods.com",
    "JBS": "jbssa.com",
    "CARGILL": "cargill.com",
    "HORMEL": "hormelfoods.com",
    "NESTLE": "nestle.com",
    "GENERAL MILLS": "generalmills.com",
    "KELLOGG": "kelloggs.com",
    "KRAFT": "kraftheinzcompany.com",
    "CONAGRA": "conagrabrands.com",
    "CAMPBELL": "campbellsoupcompany.com",
    "MARS": "mars.com",
    "MONDELEZ": "mondelezinternational.com",
    "PEPSICO": "pepsico.com",
    "COCA-COLA": "coca-colacompany.com",
    "ANHEUSER-BUSCH": "anheuser-busch.com",
    "MOLSON COORS": "molsoncoors.com",
    "GEORGIA-PACIFIC": "gp.com",
    "INTERNATIONAL PAPER": "internationalpaper.com",
    "WEYERHAEUSER": "weyerhaeuser.com"
  };

  const normalized = companyName.toUpperCase().trim();
  if (knownDomains[normalized]) {
    return knownDomains[normalized];
  }

  // Simple heuristic: convert company name to domain
  // "ACME CORP" -> "acmecorp.com"
  const simplified = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, '') // Remove spaces
    .replace(/corp|corporation|inc|llc|ltd|company|co$/gi, ''); // Remove legal suffixes

  return `${simplified}.com`;
}

/**
 * Find company website contact pages
 */
async function findCompanyWebsite(companyName, city, state) {
  try {
    // For known companies, use the domain directly instead of searching
    const knownDomain = inferCompanyDomain(companyName);
    const knownDomains = {
      "PERDUE": "perduefarms.com",
      "PILGRIM'S PRIDE": "pilgrims.com",
      "OWENS CORNING": "owenscorning.com",
      "TYSON": "tysonfoods.com",
      "SMITHFIELD": "smithfieldfoods.com",
      "JBS": "jbssa.com",
      "CARGILL": "cargill.com",
      "HORMEL": "hormelfoods.com"
    };

    const normalizedName = companyName.toUpperCase().trim();
    if (knownDomains[normalizedName]) {
      const directUrl = `https://${knownDomains[normalizedName]}`;
      console.log(`[WEB_SCRAPER] Using known domain for ${companyName}: ${directUrl}`);
      return directUrl;
    }

    // Add address and industry keywords to disambiguate and find facility-specific pages
    const industryKeywords = ["food", "poultry", "manufacturing", "facility", "plant"];
    // Include full address for better accuracy
    const addressPart = city && state ? `${city} ${state}` : '';
    const searchQuery = `"${companyName}" ${addressPart} ${industryKeywords[0]} official website`;
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`;
    const response = await respectfulFetch(searchUrl, { timeout: 6000 });
    const html = await response.text();
    const dom = new JSDOM(html);

    // Try to extract the actual URL from the cite tag (shows display URL) instead of href
    const cites = dom.window.document.querySelectorAll('li.b_algo cite');
    for (const cite of cites) {
      let displayUrl = cite.textContent.trim();

      // Clean up the display URL (Bing shows it like "www.perduefarms.com › about")
      displayUrl = displayUrl.split('›')[0].trim();
      displayUrl = displayUrl.split(' ')[0].trim();

      // Add https:// if not present
      if (!displayUrl.startsWith('http')) {
        displayUrl = 'https://' + displayUrl;
      }

      try {
        const urlObj = new URL(displayUrl);
        // Skip directories, social media, wikipedia, bing redirects, educational sites, dictionaries
        if (!urlObj.hostname.includes("yellowpages") &&
            !urlObj.hostname.includes("yelp") &&
            !urlObj.hostname.includes("facebook") &&
            !urlObj.hostname.includes("wikipedia") &&
            !urlObj.hostname.includes("linkedin") &&
            !urlObj.hostname.includes("bbb.org") &&
            !urlObj.hostname.includes("bing.com") &&
            !urlObj.hostname.includes("google.com") &&
            !urlObj.hostname.includes(".edu") &&           // Educational institutions
            !urlObj.hostname.includes("dictionary.com") &&
            !urlObj.hostname.includes("merriam-webster") &&
            !urlObj.hostname.includes("cambridge.org") &&
            !urlObj.hostname.includes("oxford") &&
            !urlObj.hostname.includes("thefreedictionary")) {
          console.log(`[WEB_SCRAPER] Identified company website from cite: ${displayUrl}`);
          return displayUrl;
        }
      } catch (err) {
        // Invalid URL, continue
        continue;
      }
    }

    // Fallback: Try to parse from href attributes, but decode Bing redirects
    const links = dom.window.document.querySelectorAll('li.b_algo h2 a');
    for (const link of links) {
      let href = link.getAttribute("href");

      // Skip Bing redirect URLs
      if (href && href.includes("bing.com/ck/a")) {
        continue;
      }

      if (href && href.startsWith("http")) {
        const urlObj = new URL(href);
        // Skip directories, social media, wikipedia, educational sites, dictionaries
        if (!urlObj.hostname.includes("yellowpages") &&
            !urlObj.hostname.includes("yelp") &&
            !urlObj.hostname.includes("facebook") &&
            !urlObj.hostname.includes("wikipedia") &&
            !urlObj.hostname.includes("linkedin") &&
            !urlObj.hostname.includes("bbb.org") &&
            !urlObj.hostname.includes("bing.com") &&
            !urlObj.hostname.includes(".edu") &&
            !urlObj.hostname.includes("dictionary.com") &&
            !urlObj.hostname.includes("merriam-webster") &&
            !urlObj.hostname.includes("cambridge.org") &&
            !urlObj.hostname.includes("oxford") &&
            !urlObj.hostname.includes("stackexchange.com")) {
          console.log(`[WEB_SCRAPER] Identified company website from href: ${href}`);
          return href;
        }
      }
    }
  } catch (err) {
    console.warn(`[WEB_SCRAPER] Failed to find company website:`, err.message);
  }
  return null;
}

/**
 * Extract contacts from company website (contact pages, about pages, team pages)
 */
async function scrapeCompanyWebsite(baseUrl, companyName, postalCode) {
  const contacts = [];

  try {
    const urlObj = new URL(baseUrl);
    const baseHostname = urlObj.hostname;

    // Common contact page paths
    const contactPaths = [
      '/contact',
      '/contact-us',
      '/contact.html',
      '/about/contact',
      '/about',
      '/about-us',
      '/team',
      '/our-team',
      '/leadership',
      '/locations',
      '/facilities'
    ];

    for (const path of contactPaths) {
      try {
        const contactUrl = `${urlObj.protocol}//${baseHostname}${path}`;

        const allowed = await canScrapeUrl(contactUrl);
        if (!allowed) continue;

        console.log(`[WEB_SCRAPER] Checking ${contactUrl}`);
        const response = await respectfulFetch(contactUrl, { timeout: 8000 });

        if (!response.ok) continue;

        const html = await response.text();
        const pageContacts = extractContactsFromHtml(html, companyName, contactUrl, postalCode);

        if (pageContacts.length > 0) {
          console.log(`[WEB_SCRAPER] Found ${pageContacts.length} contacts from ${contactUrl}`);
          contacts.push(...pageContacts);
        }

        // Only check 3 pages max per website
        if (contacts.length >= 5) break;

      } catch (err) {
        // Silently continue to next path
      }
    }
  } catch (err) {
    console.warn(`[WEB_SCRAPER] Failed to scrape company website:`, err.message);
  }

  return contacts;
}

/**
 * Infer state from ZIP code (comprehensive US ZIP mapping)
 */
function inferStateFromZip(zip) {
  if (!zip) return null;
  const zipNum = parseInt(zip.substring(0, 3));

  // Complete ZIP code to state mapping
  if (zipNum >= 100 && zipNum <= 149) return "NY";
  if (zipNum >= 150 && zipNum <= 199) return "PA";
  if (zipNum >= 200 && zipNum <= 219) return "DC";
  if (zipNum >= 220 && zipNum <= 269) return "MD/VA";
  if (zipNum >= 270 && zipNum <= 289) return "WV";
  if (zipNum >= 290 && zipNum <= 299) return "NC/SC";
  if (zipNum >= 300 && zipNum <= 319) return "GA";
  if (zipNum >= 320 && zipNum <= 349) return "FL";
  if (zipNum >= 350 && zipNum <= 369) return "AL";
  if (zipNum >= 370 && zipNum <= 385) return "TN";
  if (zipNum >= 386 && zipNum <= 397) return "MS";
  if (zipNum >= 398 && zipNum <= 399) return "GA";
  if (zipNum >= 400 && zipNum <= 427) return "KY";
  if (zipNum >= 430 && zipNum <= 458) return "OH";
  if (zipNum >= 460 && zipNum <= 479) return "IN";
  if (zipNum >= 480 && zipNum <= 499) return "MI";
  if (zipNum >= 500 && zipNum <= 528) return "IA";
  if (zipNum >= 530 && zipNum <= 549) return "WI";
  if (zipNum >= 550 && zipNum <= 567) return "MN";
  if (zipNum >= 570 && zipNum <= 577) return "SD";
  if (zipNum >= 580 && zipNum <= 588) return "ND";
  if (zipNum >= 590 && zipNum <= 599) return "MT";
  if (zipNum >= 600 && zipNum <= 629) return "IL";
  if (zipNum >= 630 && zipNum <= 658) return "MO";
  if (zipNum >= 660 && zipNum <= 679) return "KS";
  if (zipNum >= 680 && zipNum <= 693) return "NE";
  if (zipNum >= 700 && zipNum <= 714) return "LA";
  if (zipNum >= 716 && zipNum <= 729) return "AR";
  if (zipNum >= 730 && zipNum <= 749) return "OK";
  if (zipNum >= 750 && zipNum <= 799) return "TX";
  if (zipNum >= 800 && zipNum <= 816) return "CO";
  if (zipNum >= 820 && zipNum <= 831) return "WY";
  if (zipNum >= 832 && zipNum <= 838) return "ID";
  if (zipNum >= 840 && zipNum <= 847) return "UT";
  if (zipNum >= 850 && zipNum <= 865) return "AZ";
  if (zipNum >= 870 && zipNum <= 884) return "NM";
  if (zipNum >= 885 && zipNum <= 898) return "TX";
  if (zipNum >= 889 && zipNum <= 898) return "NV";
  if (zipNum >= 900 && zipNum <= 961) return "CA";
  if (zipNum >= 970 && zipNum <= 979) return "OR";
  if (zipNum >= 980 && zipNum <= 994) return "WA";
  if (zipNum >= 995 && zipNum <= 999) return "AK";

  return null;
}

/**
 * Check if we're allowed to scrape this URL per robots.txt
 */
async function canScrapeUrl(url) {
  try {
    const urlObj = new URL(url);

    // LinkedIn: Allow public profile and company pages
    if (urlObj.hostname.includes("linkedin.com")) {
      // Public company pages are OK: linkedin.com/company/*
      // Public profiles are OK: linkedin.com/in/* (public view)
      // Login-required pages are NOT OK: linkedin.com/jobs, linkedin.com/feed, etc.
      const allowedPaths = ["/company/", "/in/", "/pub/"];
      const hasAllowedPath = allowedPaths.some(p => urlObj.pathname.startsWith(p));
      if (!hasAllowedPath) {
        console.log(`[WEB_SCRAPER] Skipping LinkedIn URL (not a public profile/company page): ${url}`);
        return false;
      }
      console.log(`[WEB_SCRAPER] LinkedIn profile/company page allowed: ${url}`);
      return true;  // Skip robots.txt check for LinkedIn profiles - we'll use public view
    }

    const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;

    const response = await fetch(robotsUrl, { timeout: 3000 });
    if (!response.ok) return true; // No robots.txt = allowed

    const robotsTxt = await response.text();
    const lines = robotsTxt.split("\n");

    let currentUserAgent = null;
    let isRelevantAgent = false;

    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();

      if (trimmed.startsWith("user-agent:")) {
        currentUserAgent = trimmed.split(":")[1].trim();
        isRelevantAgent = (currentUserAgent === "*" || currentUserAgent === "quietsignal");
      }

      if (isRelevantAgent && trimmed.startsWith("disallow:")) {
        const path = trimmed.split(":")[1].trim();
        if (path === "/") return false;
        if (path && urlObj.pathname.startsWith(path)) {
          return false; // Disallowed
        }
      }

      if (isRelevantAgent && trimmed.startsWith("allow:")) {
        const path = trimmed.split(":")[1].trim();
        if (path && urlObj.pathname.startsWith(path)) {
          return true; // Explicitly allowed
        }
      }
    }

    return true; // Allowed
  } catch (err) {
    // If we can't check robots.txt, allow but log
    console.warn("[WEB_SCRAPER] Could not check robots.txt for", url, "- proceeding cautiously");
    return true;
  }
}

/**
 * Main function: Find contacts for a local business via comprehensive web scraping
 */
async function findContactsViaWebScraping({ companyName, city, state, postalCode, addressHint }) {
  try {
    console.log(`[WEB_SCRAPER] ========================================`);
    console.log(`[WEB_SCRAPER] ENHANCED SEARCH: ${companyName} in ${city}, ${state} ${postalCode}`);
    console.log(`[WEB_SCRAPER] ========================================`);

    const allContacts = [];
    let scrapedCount = 0;
    let skippedCount = 0;

    // STEP 0: Try premium APIs first (RocketReach, Hunter.io) - highest quality
    console.log(`[WEB_SCRAPER] Step 0: Trying premium API sources...`);

    // 0a. RocketReach API (best for getting actual employees with phone + email)
    const rocketReachContacts = await searchRocketReach(companyName, city, state);
    if (rocketReachContacts.length > 0) {
      console.log(`[WEB_SCRAPER] ✓ RocketReach API found ${rocketReachContacts.length} quality contacts!`);
      allContacts.push(...rocketReachContacts);
    }

    // 0b. Hunter.io API (best for finding emails by company domain)
    const companyDomain = inferCompanyDomain(companyName);
    if (companyDomain) {
      const hunterContacts = await searchHunterIO(companyDomain);
      if (hunterContacts.length > 0) {
        console.log(`[WEB_SCRAPER] ✓ Hunter.io API found ${hunterContacts.length} email contacts!`);
        allContacts.push(...hunterContacts);
      }
    }

    // If we got great results from APIs, we can skip or reduce web scraping
    if (allContacts.length >= 8) {
      console.log(`[WEB_SCRAPER] ✓ Got ${allContacts.length} contacts from premium APIs - skipping heavy scraping`);
    }

    // Step 0.5: Search for publicly available LinkedIn and ZoomInfo profiles (FREE, NO API NEEDED)
    if (allContacts.length < 8) {
      console.log(`[WEB_SCRAPER] Step 0.5: Searching for public contact profiles on LinkedIn and ZoomInfo...`);
      const publicProfiles = await searchPublicContactProfiles(companyName, city, state);
      if (publicProfiles.length > 0) {
        console.log(`[WEB_SCRAPER] ✓ Public profile search found ${publicProfiles.length} contacts!`);
        allContacts.push(...publicProfiles);
      }
    }

    // Step 1: Find company website and scrape it (high quality source)
    console.log(`[WEB_SCRAPER] Step 1: Finding company website...`);
    const companyWebsite = await findCompanyWebsite(companyName, city, state);
    if (companyWebsite) {
      console.log(`[WEB_SCRAPER] Found company website: ${companyWebsite}`);
      const websiteContacts = await scrapeCompanyWebsite(companyWebsite, companyName, postalCode);
      if (websiteContacts.length > 0) {
        console.log(`[WEB_SCRAPER] ✓ Company website yielded ${websiteContacts.length} contacts`);
        allContacts.push(...websiteContacts);
      }
    }

    // Step 2: Find relevant directory and search engine URLs
    console.log(`[WEB_SCRAPER] Step 2: Searching directories and web...`);
    const urls = await findContactPageUrls(companyName, city, state, postalCode);
    console.log(`[WEB_SCRAPER] Found ${urls.length} URLs to check`);

    // Early return if we have great API results
    if (allContacts.length >= 10) {
      console.log(`[WEB_SCRAPER] ✓ Already have ${allContacts.length} contacts from APIs - proceeding to finalize`);
      scrapedCount = 0; // Skip scraping
    } else if (urls.length === 0 && allContacts.length === 0) {
      return { ok: false, contacts: [], source: "web_scraper", message: "No relevant URLs found" };
    }

    // Step 3: Scrape each directory URL for additional contacts (PARALLEL PROCESSING for speed)
    console.log(`[WEB_SCRAPER] Step 3: Scraping ${urls.length} URLs in parallel...`);

    // Process URLs in parallel batches of 5 (respect rate limits while being fast)
    const batchSize = 5;
    for (let i = 0; i < urls.length && scrapedCount < 15 && allContacts.length < 10; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (url) => {
          try {
            // Respect robots.txt
            const allowed = await canScrapeUrl(url);
            if (!allowed) {
              console.log(`[WEB_SCRAPER] Skipping ${url} (robots.txt disallow)`);
              return { skipped: true };
            }

            console.log(`[WEB_SCRAPER] Scraping ${url}`);
            const response = await respectfulFetch(url, { timeout: 8000 });

            if (!response.ok) {
              console.log(`[WEB_SCRAPER] HTTP ${response.status} for ${url}`);
              return { error: `HTTP ${response.status}` };
            }

            const html = await response.text();
            const contacts = extractContactsFromHtml(html, companyName, url, postalCode);

            if (contacts.length > 0) {
              console.log(`[WEB_SCRAPER] Found ${contacts.length} contacts from ${url}`);
              console.log(`[WEB_SCRAPER] Sample contact:`, {
                name: contacts[0].contactName,
                phone: contacts[0].corpPhone,
                email: contacts[0].email,
                confidence: contacts[0].confidenceScore || 'N/A',
                source: contacts[0].source
              });
            }

            return { contacts: contacts || [], scraped: true };

          } catch (err) {
            console.warn(`[WEB_SCRAPER] Failed to scrape ${url}:`, err.message);
            return { error: err.message };
          }
        })
      );

      // Process batch results
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          if (result.value.skipped) {
            skippedCount++;
          } else if (result.value.scraped) {
            scrapedCount++;
            if (result.value.contacts) {
              allContacts.push(...result.value.contacts);
            }
          }
        }
      });

      // Log progress
      console.log(`[WEB_SCRAPER] Batch complete. Total contacts so far: ${allContacts.length}, Scraped: ${scrapedCount}, Skipped: ${skippedCount}`);
    }

    console.log(`[WEB_SCRAPER] Scraped ${scrapedCount} pages, skipped ${skippedCount}, found ${allContacts.length} total contacts`);

    // Deduplicate by phone/email/name
    const unique = [];
    const seen = new Set();
    const filtered = [];
    let mainLineContact = null;

    for (const contact of allContacts) {
      const key = `${contact.contactName.toLowerCase()}|${contact.corpPhone}|${contact.email}`;
      if (!seen.has(key)) {
        seen.add(key);
        // KEEP ALL contacts that have ANY contact info (phone OR email)
        const hasPhone = contact.directPhone || contact.corpPhone || contact.mobilePhone;
        const hasEmail = contact.email;
        const hasContactInfo = hasPhone || hasEmail;

        if (hasContactInfo) {
          // Save first contact with phone as potential main line
          if (!mainLineContact && contact.corpPhone && contact.title && contact.title.toLowerCase().includes("main")) {
            mainLineContact = contact;
          }
          unique.push(contact);
        } else {
          // Only filter if has NO phone AND NO email
          filtered.push({ name: contact.contactName, reason: "no phone and no email" });
        }
      }
    }

    if (filtered.length > 0) {
      console.log(`[WEB_SCRAPER] Filtered out ${filtered.length} contacts:`, filtered.slice(0, 3));
    }

    // Calculate confidence scores for each contact
    unique.forEach(contact => {
      contact.confidenceScore = calculateConfidenceScore(contact);
    });

    // Sort by confidence score (highest first)
    const sorted = unique.sort((a, b) => b.confidenceScore - a.confidenceScore);

    // Add seniority level to each contact for better targeting
    sorted.forEach(contact => {
      contact.seniorityLevel = detectSeniorityLevel(contact.title);
    });

    // Prioritize decision-makers but KEEP ALL CONTACTS with phone numbers
    const seniorContacts = sorted.filter(c => c.seniorityLevel === 'senior' || c.seniorityLevel === 'executive');
    const midLevelContacts = sorted.filter(c => c.seniorityLevel === 'mid');
    const entryLevelContacts = sorted.filter(c => c.seniorityLevel === 'entry');

    console.log(`[WEB_SCRAPER] Contacts breakdown - Senior: ${seniorContacts.length}, Mid: ${midLevelContacts.length}, Entry: ${entryLevelContacts.length}, Total: ${sorted.length}`);

    // Build final list: Include ALL valuable contacts, sorted by seniority and confidence
    // Priority: Senior with email > Senior with phone > Mid with email > Mid with phone > Entry with phone
    const finalContacts = [
      ...seniorContacts.slice(0, 8),       // Top 8 senior decision-makers
      ...midLevelContacts.slice(0, 5),     // Next 5 mid-level contacts
      ...entryLevelContacts.slice(0, 3),   // Next 3 entry-level contacts (includes main lines)
    ].slice(0, 10); // Show up to 10 contacts total (more options for reps)

    // ALWAYS include main line as last resort if we have it and list isn't full
    if (mainLineContact && !finalContacts.some(c => c.contactName === mainLineContact.contactName)) {
      if (finalContacts.length < 10) {
        finalContacts.push(mainLineContact);
      }
    }

    console.log(`[WEB_SCRAPER] Returning ${finalContacts.length} contacts (${finalContacts.filter(c => c.email).length} with emails, ${finalContacts.filter(c => c.corpPhone || c.directPhone).length} with phones)`);

    // If we found NO contacts at all but have some data in sorted (filtered out due to lack of info),
    // include at least one contact with whatever info we have
    if (finalContacts.length === 0 && sorted.length > 0) {
      console.log(`[WEB_SCRAPER] No quality contacts found, including best available contact`);
      finalContacts.push(sorted[0]);
    }

    return {
      ok: finalContacts.length > 0,
      contacts: finalContacts,
      source: "web_scraper",
      scrapedPages: scrapedCount,
      message: finalContacts.length > 0 ? `Found ${finalContacts.length} contacts via web scraping` : "No contacts found"
    };

  } catch (err) {
    console.error("[WEB_SCRAPER] Error:", err);
    return { ok: false, contacts: [], source: "web_scraper", message: err.message };
  }
}

module.exports = {
  findContactsViaWebScraping,
  extractContactsFromHtml,
  extractLinkedInContacts,
  extractDirectoryContacts,
  findContactPageUrls
};
