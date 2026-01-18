// =====================================================
// APOLLO.IO INTENT SIGNAL ADAPTER
// Real buyer intent data from Apollo.io's 210M+ contacts
// =====================================================

const https = require('https');

class ApolloIntentAdapter {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.sourceName = 'apollo';
    this.baseUrl = 'api.apollo.io';

    // Rate limiting - Apollo free tier is limited
    this.requestsThisMinute = 0;
    this.lastRequestTime = Date.now();
    this.maxRequestsPerMinute = 50; // Conservative limit for free tier

    // Cache to reduce API calls
    this.cache = new Map();
    this.cacheTTL = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Make an API request to Apollo
   */
  async makeRequest(endpoint, method = 'POST', body = null) {
    // Rate limiting
    await this.checkRateLimit();

    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        path: endpoint,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': this.apiKey
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);

            // Check for API errors
            if (res.statusCode >= 400) {
              console.error(`[Apollo API] Error ${res.statusCode}:`, parsed);
              reject(new Error(parsed.error || parsed.message || `HTTP ${res.statusCode}`));
              return;
            }

            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse Apollo response: ${e.message}`));
          }
        });
      });

      req.on('error', (e) => {
        console.error('[Apollo API] Request error:', e.message);
        reject(e);
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Apollo API request timed out'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
      this.requestsThisMinute++;
    });
  }

  /**
   * Rate limit check
   */
  async checkRateLimit() {
    const now = Date.now();

    // Reset counter every minute
    if (now - this.lastRequestTime > 60000) {
      this.requestsThisMinute = 0;
      this.lastRequestTime = now;
    }

    // Wait if we've hit the limit
    if (this.requestsThisMinute >= this.maxRequestsPerMinute) {
      const waitTime = 60000 - (now - this.lastRequestTime);
      console.log(`[Apollo] Rate limit reached, waiting ${Math.ceil(waitTime/1000)}s`);
      await new Promise(resolve => setTimeout(resolve, waitTime + 100));
      this.requestsThisMinute = 0;
      this.lastRequestTime = Date.now();
    }
  }

  /**
   * Search for companies/organizations matching criteria
   */
  async searchOrganizations(params) {
    const cacheKey = `org_${JSON.stringify(params)}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const body = {
      page: params.page || 1,
      per_page: Math.min(params.per_page || 25, 100),
      organization_locations: params.locations || [],
      organization_num_employees_ranges: params.employee_ranges || [],
      q_organization_keyword_tags: params.keywords || [],
      organization_industry_tag_ids: params.industries || []
    };

    // Add zip code based location if provided
    if (params.zip_codes && params.zip_codes.length > 0) {
      // Apollo uses city/state, so we'll search more broadly
      // The zip codes will be used for post-filtering
      body.organization_locations = params.locations || ['United States'];
    }

    try {
      const result = await this.makeRequest('/api/v1/mixed_companies/search', 'POST', body);
      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error('[Apollo] Organization search failed:', error.message);
      throw error;
    }
  }

  /**
   * Search for people/contacts at companies
   */
  async searchPeople(params) {
    const cacheKey = `people_${JSON.stringify(params)}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    // Build query parameters for the mixed_people endpoint
    const queryParams = new URLSearchParams();

    if (params.titles && params.titles.length > 0) {
      params.titles.forEach(t => queryParams.append('person_titles[]', t));
    }

    if (params.locations && params.locations.length > 0) {
      params.locations.forEach(l => queryParams.append('person_locations[]', l));
    }

    if (params.seniorities && params.seniorities.length > 0) {
      params.seniorities.forEach(s => queryParams.append('person_seniorities[]', s));
    }

    if (params.organization_ids && params.organization_ids.length > 0) {
      params.organization_ids.forEach(id => queryParams.append('organization_ids[]', id));
    }

    if (params.industries && params.industries.length > 0) {
      params.industries.forEach(i => queryParams.append('organization_industry_tag_ids[]', i));
    }

    queryParams.append('per_page', Math.min(params.per_page || 25, 100));
    queryParams.append('page', params.page || 1);

    try {
      const result = await this.makeRequest(
        `/api/v1/mixed_people/search?${queryParams.toString()}`,
        'POST'
      );
      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error('[Apollo] People search failed:', error.message);
      throw error;
    }
  }

  /**
   * Enrich a person to get contact details (uses credits)
   */
  async enrichPerson(params) {
    const cacheKey = `enrich_${params.id || params.email || params.linkedin_url}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const body = {};

    if (params.id) body.id = params.id;
    if (params.email) body.email = params.email;
    if (params.linkedin_url) body.linkedin_url = params.linkedin_url;
    if (params.first_name) body.first_name = params.first_name;
    if (params.last_name) body.last_name = params.last_name;
    if (params.organization_name) body.organization_name = params.organization_name;
    if (params.domain) body.domain = params.domain;

    try {
      const result = await this.makeRequest('/api/v1/people/match', 'POST', body);
      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error('[Apollo] Person enrichment failed:', error.message);
      throw error;
    }
  }

  /**
   * Get organization details
   */
  async getOrganization(orgId) {
    const cacheKey = `org_detail_${orgId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.makeRequest(`/api/v1/organizations/${orgId}`, 'GET');
      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error('[Apollo] Get organization failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate intent signals based on Apollo data
   * This is the main method called by the IntentSignalService
   */
  async generateSignals(keywords, zipCodes, count = 10, filters = {}) {
    console.log(`[Apollo] Generating signals for keywords: ${keywords.join(', ')}`);

    if (!this.apiKey) {
      throw new Error('Apollo API key not configured. Set APOLLO_API_KEY environment variable.');
    }

    const signals = [];

    try {
      // Step 1: Search for relevant organizations
      const orgSearchParams = {
        keywords: keywords,
        locations: this.zipCodesToLocations(zipCodes),
        employee_ranges: this.buildEmployeeRanges(filters),
        per_page: Math.min(count * 2, 100), // Get more orgs than needed for filtering
        page: 1
      };

      const orgResults = await this.searchOrganizations(orgSearchParams);
      const organizations = orgResults.organizations || orgResults.accounts || [];

      console.log(`[Apollo] Found ${organizations.length} organizations`);

      if (organizations.length === 0) {
        console.log('[Apollo] No organizations found, returning empty signals');
        return [];
      }

      // Step 2: For each organization, find decision makers
      for (const org of organizations.slice(0, count)) {
        try {
          // Search for decision makers at this company
          const peopleParams = {
            organization_ids: [org.id],
            seniorities: ['owner', 'founder', 'c_suite', 'vp', 'director', 'manager'],
            titles: this.getRelevantTitles(keywords),
            per_page: 3
          };

          const peopleResults = await this.searchPeople(peopleParams);
          const people = peopleResults.people || peopleResults.contacts || [];

          // Pick the best contact (highest seniority)
          const bestContact = people[0] || null;

          // Build the signal
          const signal = this.buildSignalFromApollo(org, bestContact, keywords, filters);

          if (signal) {
            signals.push(signal);
          }

          // Small delay to be nice to the API
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (personError) {
          console.warn(`[Apollo] Failed to get contacts for ${org.name}:`, personError.message);
          // Still create a signal without contact info
          const signal = this.buildSignalFromApollo(org, null, keywords, filters);
          if (signal) signals.push(signal);
        }
      }

      // Sort by score
      signals.sort((a, b) => b.overall_score - a.overall_score);

      console.log(`[Apollo] Generated ${signals.length} signals`);
      return signals;

    } catch (error) {
      console.error('[Apollo] Signal generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Build an intent signal from Apollo organization and person data
   */
  buildSignalFromApollo(org, contact, keywords, filters) {
    if (!org) return null;

    const matchedKeyword = keywords[0]; // Primary keyword
    const now = new Date();

    // Calculate scores
    const fitScore = this.calculateFitScore(org, filters);
    const engagementScore = this.calculateEngagementScore(org);
    const recencyScore = 85; // Apollo data is generally fresh
    const keywordMatchStrength = this.calculateKeywordMatch(org, keywords);
    const contactBonus = contact ? 20 : 0;

    const overallScore = Math.round(
      (recencyScore * 0.25) +
      (keywordMatchStrength * 0.25) +
      (fitScore * 0.25) +
      (engagementScore * 0.15) +
      (contactBonus * 0.10)
    );

    const priority = this.determinePriority(overallScore, fitScore, contact);

    // Build search context from company keywords/technologies
    const searchContext = this.buildSearchContext(org, keywords);

    const signal = {
      // Company info
      company_name: org.name || 'Unknown Company',
      company_address: org.street_address || org.raw_address || '',
      company_city: org.city || '',
      company_state: org.state || '',
      company_zip: org.postal_code || org.zip || '',
      company_phone: org.phone || org.sanitized_phone || '',
      company_website: org.website_url || org.domain || '',
      company_industry: org.industry || this.extractIndustry(org),
      company_employee_count: org.estimated_num_employees || org.employee_count || null,
      company_revenue_cents: this.parseRevenue(org.annual_revenue) || null,

      // Apollo-specific data
      apollo_org_id: org.id,
      company_linkedin_url: org.linkedin_url || null,
      company_facebook_url: org.facebook_url || null,
      company_twitter_url: org.twitter_url || null,
      technologies_used: (org.technologies || []).slice(0, 10).join(', '),
      funding_total: org.total_funding || null,
      founded_year: org.founded_year || null,

      // Signal data
      matched_keyword: matchedKeyword,
      keyword_match_strength: keywordMatchStrength,
      search_context: searchContext,
      intent_source: 'apollo',
      intent_category: this.determineIntentCategory(org, keywords),

      // Scores
      overall_score: overallScore,
      recency_score: recencyScore,
      fit_score: fitScore,
      engagement_score: engagementScore,
      priority: priority,

      // Timing
      signal_detected_at: now.toISOString(),
      freshness_hours: 0,
      expires_at: new Date(now.getTime() + 72 * 3600000).toISOString(), // 72 hour expiry

      // Contact info (if available)
      contact_name: contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : null,
      contact_title: contact?.title || null,
      contact_email: contact?.email || null, // May require enrichment credits
      contact_phone: contact?.phone_numbers?.[0]?.sanitized_number || null,
      contact_linkedin_url: contact?.linkedin_url || null,
      decision_maker_likelihood: contact ? this.calculateDecisionMakerScore(contact) : null,
      apollo_person_id: contact?.id || null
    };

    return signal;
  }

  /**
   * Helper: Convert zip codes to Apollo location format
   */
  zipCodesToLocations(zipCodes) {
    // Apollo doesn't search by zip directly, so we use broader US location
    // The zip codes are used for post-filtering if needed
    if (!zipCodes || zipCodes.length === 0) {
      return ['United States'];
    }

    // Map common zip prefixes to states (simplified)
    const statesByZipPrefix = {
      '75': 'Texas, United States',
      '77': 'Texas, United States',
      '78': 'Texas, United States',
      '79': 'Texas, United States',
      '90': 'California, United States',
      '91': 'California, United States',
      '92': 'California, United States',
      '93': 'California, United States',
      '94': 'California, United States',
      '10': 'New York, United States',
      '11': 'New York, United States',
      '12': 'New York, United States',
      '33': 'Florida, United States',
      '32': 'Florida, United States',
      '60': 'Illinois, United States',
      '30': 'Georgia, United States',
      '85': 'Arizona, United States',
      '80': 'Colorado, United States'
    };

    const locations = new Set();
    for (const zip of zipCodes) {
      const prefix = String(zip).substring(0, 2);
      if (statesByZipPrefix[prefix]) {
        locations.add(statesByZipPrefix[prefix]);
      }
    }

    return locations.size > 0 ? Array.from(locations) : ['United States'];
  }

  /**
   * Helper: Build employee range filters
   */
  buildEmployeeRanges(filters) {
    const ranges = [];

    if (filters.company_size_min || filters.company_size_max) {
      const min = filters.company_size_min || 1;
      const max = filters.company_size_max || 10000;

      // Apollo uses predefined ranges
      const apolloRanges = [
        { range: '1,10', min: 1, max: 10 },
        { range: '11,20', min: 11, max: 20 },
        { range: '21,50', min: 21, max: 50 },
        { range: '51,100', min: 51, max: 100 },
        { range: '101,200', min: 101, max: 200 },
        { range: '201,500', min: 201, max: 500 },
        { range: '501,1000', min: 501, max: 1000 },
        { range: '1001,2000', min: 1001, max: 2000 },
        { range: '2001,5000', min: 2001, max: 5000 },
        { range: '5001,10000', min: 5001, max: 10000 }
      ];

      for (const r of apolloRanges) {
        if (r.max >= min && r.min <= max) {
          ranges.push(r.range);
        }
      }
    }

    // Default to small-medium businesses if no filter
    if (ranges.length === 0) {
      ranges.push('1,10', '11,20', '21,50', '51,100', '101,200');
    }

    return ranges;
  }

  /**
   * Helper: Get relevant job titles based on keywords
   */
  getRelevantTitles(keywords) {
    const keywordLower = keywords.map(k => k.toLowerCase()).join(' ');

    // Default decision maker titles
    const titles = ['Owner', 'General Manager', 'Director', 'Manager'];

    // Add specific titles based on keywords
    if (keywordLower.includes('restaurant') || keywordLower.includes('food')) {
      titles.push('Executive Chef', 'F&B Director', 'Kitchen Manager', 'Operations Manager');
    }
    if (keywordLower.includes('equipment') || keywordLower.includes('supplies')) {
      titles.push('Purchasing Manager', 'Procurement Director', 'Facilities Manager');
    }
    if (keywordLower.includes('pos') || keywordLower.includes('software')) {
      titles.push('IT Director', 'Technology Manager', 'Operations Director');
    }
    if (keywordLower.includes('catering')) {
      titles.push('Catering Director', 'Events Manager', 'Sales Manager');
    }

    return titles;
  }

  /**
   * Helper: Calculate fit score
   */
  calculateFitScore(org, filters) {
    let score = 60; // Base score

    // Employee count fit
    const empCount = org.estimated_num_employees || 0;
    if (filters.company_size_min && empCount >= filters.company_size_min) score += 10;
    if (filters.company_size_max && empCount <= filters.company_size_max) score += 10;

    // Has website (more established)
    if (org.website_url || org.domain) score += 5;

    // Has phone (contactable)
    if (org.phone || org.sanitized_phone) score += 5;

    // Industry relevance
    const relevantIndustries = ['restaurants', 'food', 'hospitality', 'catering', 'hotel', 'bar'];
    if (relevantIndustries.some(i => (org.industry || '').toLowerCase().includes(i))) {
      score += 10;
    }

    return Math.min(100, score);
  }

  /**
   * Helper: Calculate engagement score based on company attributes
   */
  calculateEngagementScore(org) {
    let score = 50; // Base score

    // Larger companies = more potential
    const empCount = org.estimated_num_employees || 0;
    if (empCount > 50) score += 10;
    if (empCount > 100) score += 10;

    // Has LinkedIn presence
    if (org.linkedin_url) score += 10;

    // Uses relevant technologies
    const technologies = org.technologies || [];
    if (technologies.length > 0) score += 5;
    if (technologies.some(t => ['toast', 'square', 'clover', 'shopify'].includes(t.toLowerCase()))) {
      score += 15; // Already uses POS/commerce tech
    }

    return Math.min(100, score);
  }

  /**
   * Helper: Calculate keyword match strength
   */
  calculateKeywordMatch(org, keywords) {
    let score = 60; // Base score

    const orgText = [
      org.name,
      org.industry,
      org.short_description,
      ...(org.keywords || [])
    ].filter(Boolean).join(' ').toLowerCase();

    for (const keyword of keywords) {
      if (orgText.includes(keyword.toLowerCase())) {
        score += 15;
      }
    }

    return Math.min(100, score);
  }

  /**
   * Helper: Build search context from org data
   */
  buildSearchContext(org, keywords) {
    const parts = [];

    if (org.industry) {
      parts.push(`${org.industry} business`);
    }

    if (org.estimated_num_employees) {
      parts.push(`${org.estimated_num_employees} employees`);
    }

    if (org.keywords && org.keywords.length > 0) {
      parts.push(`Keywords: ${org.keywords.slice(0, 3).join(', ')}`);
    }

    if (keywords.length > 0) {
      parts.push(`Searching for: ${keywords[0]}`);
    }

    return parts.join(' | ') || 'Company in target market';
  }

  /**
   * Helper: Determine intent category
   */
  determineIntentCategory(org, keywords) {
    const keywordLower = keywords.map(k => k.toLowerCase()).join(' ');

    if (keywordLower.includes('buy') || keywordLower.includes('purchase') || keywordLower.includes('price')) {
      return 'purchase_ready';
    }
    if (keywordLower.includes('compare') || keywordLower.includes('best') || keywordLower.includes('vs')) {
      return 'comparison';
    }
    return 'research';
  }

  /**
   * Helper: Determine priority
   */
  determinePriority(overallScore, fitScore, hasContact) {
    if (overallScore >= 80 && hasContact) return 'critical';
    if (overallScore >= 70 || (fitScore >= 80 && hasContact)) return 'high';
    if (overallScore >= 50) return 'medium';
    return 'low';
  }

  /**
   * Helper: Calculate decision maker score
   */
  calculateDecisionMakerScore(contact) {
    if (!contact) return null;

    let score = 50;
    const title = (contact.title || '').toLowerCase();

    if (title.includes('owner') || title.includes('ceo') || title.includes('founder')) score = 95;
    else if (title.includes('president') || title.includes('vp') || title.includes('vice president')) score = 90;
    else if (title.includes('director') || title.includes('head of')) score = 85;
    else if (title.includes('manager')) score = 75;
    else if (title.includes('chef') && title.includes('executive')) score = 80;

    return Math.min(100, score);
  }

  /**
   * Helper: Extract industry from org data
   */
  extractIndustry(org) {
    if (org.industry) return org.industry;

    const keywords = org.keywords || [];
    const industryKeywords = ['restaurant', 'hotel', 'hospitality', 'food', 'catering', 'bar', 'cafe'];

    for (const k of keywords) {
      for (const ind of industryKeywords) {
        if (k.toLowerCase().includes(ind)) {
          return k;
        }
      }
    }

    return 'Business Services';
  }

  /**
   * Helper: Parse revenue string to cents
   */
  parseRevenue(revenueStr) {
    if (!revenueStr) return null;

    // Handle numeric values
    if (typeof revenueStr === 'number') {
      return revenueStr * 100;
    }

    // Handle string ranges like "$1M-$10M"
    const str = String(revenueStr).toLowerCase();
    const match = str.match(/\$?([\d.]+)\s*(k|m|b)?/);

    if (match) {
      let value = parseFloat(match[1]);
      const multiplier = match[2];

      if (multiplier === 'k') value *= 1000;
      else if (multiplier === 'm') value *= 1000000;
      else if (multiplier === 'b') value *= 1000000000;

      return Math.round(value * 100);
    }

    return null;
  }

  /**
   * Cache helpers
   */
  getFromCache(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });

    // Cleanup old entries periodically
    if (this.cache.size > 1000) {
      const now = Date.now();
      for (const [k, v] of this.cache.entries()) {
        if (now - v.timestamp > this.cacheTTL) {
          this.cache.delete(k);
        }
      }
    }
  }

  /**
   * Test the API connection
   */
  async testConnection() {
    try {
      // Simple search to verify API key works
      const result = await this.searchOrganizations({
        keywords: ['restaurant'],
        locations: ['Texas, United States'],
        per_page: 1
      });

      return {
        success: true,
        message: 'Apollo API connection successful',
        sample_count: (result.organizations || []).length
      };
    } catch (error) {
      return {
        success: false,
        message: `Apollo API connection failed: ${error.message}`
      };
    }
  }
}

module.exports = ApolloIntentAdapter;
