/**
 * Lead5 Scout - Finds executive job postings on Lead5.com
 *
 * This scout logs into Lead5, searches for executive opportunities,
 * extracts data, and POSTs signals to Outbound.
 */

import 'dotenv/config';
import { chromium, Browser, Page } from 'playwright';
import { loadConfig, Config } from './config.js';
import { OutboundClient, SignalPayload } from './outbound-client.js';

interface Opportunity {
  id: string;
  title: string;
  company: string;
  metro: string;
  postedDate: string;
  description: string;
  url: string;
}

// === Enriched Data Types ===

interface CompanyContact {
  name: string;
  title: string;
  email?: string;
  phone?: string;
}

interface CompanyMetadata {
  industry?: string;
  marketCap?: string;
  ownership?: string;  // "PE-backed", "Public", "Private", "Family-owned"
  function?: string;   // Job function category
}

interface ExecutiveMove {
  name: string;
  title: string;
  moveType: string;  // "joined", "promoted", "departed", "hired"
  date?: string;
}

interface RelatedOpportunity {
  id: string;
  title: string;
  url?: string;
}

interface EnrichedOpportunity extends Opportunity {
  // Full description (not truncated)
  fullDescription?: string;

  // Company info
  companyMetadata?: CompanyMetadata;

  // Contacts at company
  contacts?: CompanyContact[];

  // Recent moves at company
  executiveMoves?: ExecutiveMove[];

  // Other postings at same company
  relatedOpportunities?: RelatedOpportunity[];

  // Enrichment tracking
  enrichmentStatus: 'success' | 'failed' | 'skipped';
  enrichmentError?: string;
}

async function login(page: Page, config: Config): Promise<boolean> {
  console.log('Navigating to Lead5 login...');
  await page.goto('https://lead5.com/users/sign_in');

  // Wait for login form
  await page.waitForSelector('input[type="email"], input#user_email', { timeout: 10000 });

  // Fill credentials
  await page.fill('input[type="email"], input#user_email', config.lead5Email);
  await page.fill('input[type="password"], input#user_password', config.lead5Password);

  // Submit
  await page.click('input[type="submit"], button[type="submit"]');

  // Wait for redirect (either dashboard or app)
  try {
    await page.waitForURL(/\/(business\/dashboard|l5\/app)/, { timeout: 15000 });
    console.log('Login successful');
    return true;
  } catch (error) {
    console.error('Login failed - did not redirect to expected page');
    return false;
  }
}

async function navigateToSearch(page: Page): Promise<void> {
  console.log('Navigating to executive search...');
  await page.goto('https://lead5.com/l5/app/#/l5/app/Search/1');

  // Wait for the search page to load
  await page.waitForTimeout(3000); // Angular app needs time to render

  // Click on "My5 Jobs" to trigger the search
  try {
    console.log('Clicking My5 Jobs to load results...');
    await page.click('text=My5 Jobs');
    await page.waitForTimeout(3000);
  } catch (error) {
    console.log('Could not click My5 Jobs, continuing anyway');
  }
}

async function extractOpportunities(page: Page, maxResults: number): Promise<Opportunity[]> {
  console.log('Extracting opportunities from search results...');

  const opportunities: Opportunity[] = [];

  // Wait for results to load (Angular app)
  await page.waitForTimeout(3000);

  // Debug: Log page content to understand structure
  const bodyText = await page.locator('body').textContent();
  console.log('Page text sample:', bodyText?.slice(0, 500));

  // Wait for specific content that indicates results loaded
  try {
    await page.waitForSelector('text=Vacancy', { timeout: 10000 });
    console.log('Found "Vacancy" text on page');
  } catch {
    console.log('No "Vacancy" text found, trying alternatives...');
    try {
      await page.waitForSelector('text=POTENTIAL OPPORTUNITY', { timeout: 5000 });
      console.log('Found "POTENTIAL OPPORTUNITY" text');
    } catch {
      console.log('Could not find expected content markers');
    }
  }

  // Scroll to trigger any lazy loading
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(1000);

  // Check for iframes
  const iframes = await page.locator('iframe').all();
  console.log(`Found ${iframes.length} iframes`);

  // Debug: Count all links and their text
  const linkDebug = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    const linkTexts: string[] = [];
    links.forEach(l => {
      const text = (l.textContent || '').trim();
      if (text.length > 5 && text.length < 100) {
        linkTexts.push(text);
      }
    });
    // Also check for any element containing 'Vacancy'
    const vacancyElements = document.querySelectorAll('*');
    let vacancyCount = 0;
    vacancyElements.forEach(el => {
      if ((el.textContent || '').includes('Vacancy')) vacancyCount++;
    });
    return { count: links.length, samples: linkTexts.slice(0, 20), vacancyCount };
  });
  console.log(`Total links: ${linkDebug.count}, elements with 'Vacancy': ${linkDebug.vacancyCount}`);
  console.log('Sample link texts:', linkDebug.samples);

  // If there are iframes, try to access their content
  if (iframes.length > 0) {
    console.log('Attempting to access iframe content...');
    for (let i = 0; i < iframes.length; i++) {
      try {
        const frame = await iframes[i].contentFrame();
        if (frame) {
          const frameText = await frame.locator('body').textContent();
          console.log(`Iframe ${i} text sample:`, frameText?.slice(0, 300));
        }
      } catch (e) {
        console.log(`Could not access iframe ${i}`);
      }
    }
  }

  // Use JavaScript evaluation to extract opportunities directly from the DOM
  // Search ALL elements for opportunity titles, not just links
  const extractedData = await page.evaluate(() => {
    const results: Array<{
      title: string;
      href: string;
      cardText: string;
    }> = [];
    const seenTitles = new Set<string>();

    // Find ALL elements containing vacancy/opportunity keywords
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      const text = el.textContent || '';
      const directText = el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE
        ? (el.childNodes[0] as Text).textContent || ''
        : '';

      // Look for title-like text (short, contains keywords)
      const checkText = directText || (text.length < 100 ? text : '');

      if ((checkText.includes('Vacancy') || checkText.includes('Chief Technology Officer') ||
           checkText.includes('Chief Information Officer') || checkText.includes('Chief Financial Officer') ||
           checkText.includes('Chief Security Officer')) &&
          checkText.length > 15 && checkText.length < 100) {

        const title = checkText.trim();
        if (seenTitles.has(title)) return;
        seenTitles.add(title);

        // Find href - look for nearby link or in ancestors
        let href = '';
        const nearestLink = el.querySelector('a') || el.closest('a');
        if (nearestLink) {
          href = nearestLink.getAttribute('href') || '';
        }

        // Get parent container for more context
        let parent = el.parentElement;
        let cardText = '';
        for (let i = 0; i < 8 && parent; i++) {
          cardText = parent.textContent || '';
          if (cardText.length > 300 && cardText.includes('Posted:')) break;
          parent = parent.parentElement;
        }

        results.push({
          title,
          href,
          cardText: cardText.slice(0, 1500),
        });
      }
    });

    return results;
  });

  console.log(`Found ${extractedData.length} potential opportunities via JS evaluation`);

  for (let i = 0; i < Math.min(extractedData.length, maxResults); i++) {
    const data = extractedData[i];

    // Skip navigation links
    if (data.title.length < 10 || data.title.includes('Menu')) continue;

    // Extract ID from href, or create stable ID from title
    const idMatch = data.href.match(/ArticleDetails\/(\d+)/);
    // Use article ID if available, otherwise create stable slug from title
    const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50);
    const id = idMatch ? idMatch[1] : slugify(data.title);

    // Extract company from title
    const atMatch = data.title.match(/at\s+(.+?)(?:\s*$)/i);
    const company = atMatch ? atMatch[1].trim() : '';

    // Extract metro from card text
    const metroMatch = data.cardText.match(/Metro:\s*([^\n]+?)(?:\s*Posted|$)/);
    const metro = metroMatch ? metroMatch[1].trim() : '';

    // Extract posted date
    let postedDate = new Date().toISOString().split('T')[0];
    const dateMatch = data.cardText.match(/Posted:\s*([A-Za-z]+\s+\d+,\s*\d{4})/);
    if (dateMatch) {
      const parsed = new Date(dateMatch[1]);
      if (!isNaN(parsed.getTime())) {
        postedDate = parsed.toISOString().split('T')[0];
      }
    }

    // Extract description - text after POTENTIAL OPPORTUNITY or the main body
    let description = '';
    const descMatch = data.cardText.match(/(?:POTENTIAL OPPORTUNITY|Member Contributed)\s*([^0]+)/);
    if (descMatch) {
      description = descMatch[1].trim().slice(0, 500);
    }

    if (data.title && company) {
      opportunities.push({
        id,
        title: data.title,
        company,
        metro,
        postedDate,
        description,
        url: data.href.startsWith('http') ? data.href : (data.href ? `https://lead5.com${data.href}` : ''),
      });
      console.log(`  Found: ${data.title} (${company})`);
    }
  }

  return opportunities;
}

// === Detail Page Enrichment ===

async function extractDetailPage(
  page: Page,
  opportunity: Opportunity,
  rateLimitMs: number
): Promise<Partial<EnrichedOpportunity>> {
  // Skip if no valid URL
  if (!opportunity.url || !opportunity.url.includes('ArticleDetails')) {
    return { enrichmentStatus: 'skipped', enrichmentError: 'No valid detail URL' };
  }

  try {
    console.log(`    Fetching detail page...`);

    // Navigate to detail page
    await page.goto(opportunity.url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for Angular app to render
    await page.waitForTimeout(3000);

    // Extract ALL data using page.evaluate()
    const detailData = await page.evaluate(() => {
      const result: {
        fullDescription?: string;
        industry?: string;
        marketCap?: string;
        ownership?: string;
        function?: string;
        contacts: Array<{ name: string; title: string; email?: string; phone?: string }>;
        executiveMoves: Array<{ name: string; title: string; moveType: string; date?: string }>;
        relatedOpportunities: Array<{ id: string; title: string; url?: string }>;
      } = {
        contacts: [],
        executiveMoves: [],
        relatedOpportunities: [],
      };

      const bodyText = document.body.textContent || '';

      // === FULL DESCRIPTION ===
      // Look for main content area - try multiple selectors
      const descriptionSelectors = [
        '.article-description',
        '.opportunity-detail',
        '[class*="description"]',
        '.content-body',
        '.article-content',
        'article',
      ];
      for (const selector of descriptionSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent && el.textContent.length > 200) {
          result.fullDescription = el.textContent.trim().slice(0, 5000);
          break;
        }
      }
      // Fallback: get largest text block
      if (!result.fullDescription) {
        const allDivs = document.querySelectorAll('div');
        let longestText = '';
        allDivs.forEach(div => {
          const text = div.textContent || '';
          if (text.length > longestText.length && text.length < 10000) {
            longestText = text;
          }
        });
        if (longestText.length > 500) {
          result.fullDescription = longestText.trim().slice(0, 5000);
        }
      }

      // === COMPANY METADATA ===
      // Industry
      const industryMatch = bodyText.match(/Industry[:\s]+([^\n]+)/i);
      if (industryMatch) result.industry = industryMatch[1].trim().slice(0, 100);

      // Market Cap
      const marketCapMatch = bodyText.match(/Market[- ]?Cap[:\s]+([^\n$]+)/i);
      if (marketCapMatch) result.marketCap = marketCapMatch[1].trim().slice(0, 50);

      // Ownership
      const ownershipMatch = bodyText.match(/Ownership[:\s]+([^\n]+)/i);
      if (ownershipMatch) result.ownership = ownershipMatch[1].trim().slice(0, 50);

      // Function
      const functionMatch = bodyText.match(/Function[:\s]+([^\n]+)/i);
      if (functionMatch) result.function = functionMatch[1].trim().slice(0, 50);

      // === COMPANY CONTACTS ===
      // Look for contact sections
      const contactSelectors = [
        '[class*="contact"]',
        '[class*="Contact"]',
        '.company-contacts li',
        '[class*="person"]',
      ];
      const seenContacts = new Set<string>();

      for (const selector of contactSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = el.textContent || '';
          if (text.length < 10 || text.length > 500) return;

          // Look for name + title patterns
          // Pattern: "John Smith, CFO" or "John Smith - Chief Financial Officer"
          const patterns = [
            /([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[-,]\s*([\w\s]+)/,
            /([\w\s]+)\s*\|\s*([\w\s]+)/,
          ];

          for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
              const name = match[1].trim();
              const title = match[2].trim();
              const key = `${name}-${title}`;
              if (!seenContacts.has(key) && name.length > 3 && title.length > 2) {
                seenContacts.add(key);

                // Look for email in same element
                const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
                // Look for phone
                const phoneMatch = text.match(/[\d-().]{10,}/);

                result.contacts.push({
                  name,
                  title,
                  email: emailMatch ? emailMatch[0] : undefined,
                  phone: phoneMatch ? phoneMatch[0] : undefined,
                });
              }
              break;
            }
          }
        });
      }

      // === EXECUTIVE MOVES ===
      // Look for recent moves section
      const moveSelectors = [
        '[class*="executive"]',
        '[class*="move"]',
        '.recent-moves li',
        '[class*="hired"]',
        '[class*="departed"]',
      ];
      const seenMoves = new Set<string>();

      for (const selector of moveSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = el.textContent || '';
          if (text.length < 10 || text.length > 500) return;

          // Look for move patterns
          const moveMatch = text.match(/(joined|departed|promoted|hired|appointed|named|left)/i);
          if (moveMatch) {
            // Try to extract name and title
            const nameMatch = text.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
            const titleMatch = text.match(/(CEO|CFO|CIO|CTO|CISO|VP|Director|President|Chief[\w\s]+Officer)/i);

            if (nameMatch) {
              const key = `${nameMatch[1]}-${moveMatch[1]}`;
              if (!seenMoves.has(key)) {
                seenMoves.add(key);
                result.executiveMoves.push({
                  name: nameMatch[1],
                  title: titleMatch ? titleMatch[1] : 'Unknown',
                  moveType: moveMatch[1].toLowerCase(),
                });
              }
            }
          }
        });
      }

      // === RELATED OPPORTUNITIES ===
      // Look for related/similar opportunities
      const relatedSelectors = [
        '[class*="related"] a',
        '.similar-opportunities a',
        '[class*="Related"] a',
      ];

      for (const selector of relatedSelectors) {
        const links = document.querySelectorAll(selector);
        links.forEach(link => {
          const href = link.getAttribute('href') || '';
          const text = link.textContent || '';

          // Check if it's an opportunity link
          const idMatch = href.match(/ArticleDetails\/(\d+)/);
          if (idMatch && text.length > 5) {
            result.relatedOpportunities.push({
              id: idMatch[1],
              title: text.trim().slice(0, 100),
              url: href.startsWith('http') ? href : `https://lead5.com${href}`,
            });
          }
        });
      }

      return result;
    });

    // Add jitter to rate limit (appear more human)
    const jitter = Math.floor(Math.random() * 1000);
    await page.waitForTimeout(rateLimitMs + jitter);

    return {
      fullDescription: detailData.fullDescription,
      companyMetadata: {
        industry: detailData.industry,
        marketCap: detailData.marketCap,
        ownership: detailData.ownership,
        function: detailData.function,
      },
      contacts: detailData.contacts,
      executiveMoves: detailData.executiveMoves,
      relatedOpportunities: detailData.relatedOpportunities,
      enrichmentStatus: 'success',
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`    Failed to extract detail page: ${errorMsg}`);
    return {
      enrichmentStatus: 'failed',
      enrichmentError: errorMsg,
    };
  }
}

async function enrichOpportunities(
  page: Page,
  opportunities: Opportunity[],
  rateLimitMs: number
): Promise<EnrichedOpportunity[]> {
  const enriched: EnrichedOpportunity[] = [];

  console.log(`\nEnriching ${opportunities.length} opportunities with detail page data...`);

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    console.log(`  [${i + 1}/${opportunities.length}] ${opp.company} - ${opp.title}`);

    const detailData = await extractDetailPage(page, opp, rateLimitMs);

    enriched.push({
      ...opp,
      fullDescription: detailData.fullDescription,
      companyMetadata: detailData.companyMetadata,
      contacts: detailData.contacts,
      executiveMoves: detailData.executiveMoves,
      relatedOpportunities: detailData.relatedOpportunities,
      enrichmentStatus: detailData.enrichmentStatus || 'skipped',
      enrichmentError: detailData.enrichmentError,
    });

    // Log what we found
    if (detailData.enrichmentStatus === 'success') {
      const contactCount = detailData.contacts?.length || 0;
      const moveCount = detailData.executiveMoves?.length || 0;
      const hasMetadata = detailData.companyMetadata?.industry || detailData.companyMetadata?.ownership;
      console.log(`    ✓ Enriched: ${contactCount} contacts, ${moveCount} moves, metadata: ${hasMetadata ? 'yes' : 'no'}`);
    }
  }

  // Log enrichment stats
  const stats = {
    total: enriched.length,
    success: enriched.filter(e => e.enrichmentStatus === 'success').length,
    failed: enriched.filter(e => e.enrichmentStatus === 'failed').length,
    skipped: enriched.filter(e => e.enrichmentStatus === 'skipped').length,
  };
  console.log(`\nEnrichment complete: ${stats.success} success, ${stats.failed} failed, ${stats.skipped} skipped`);

  return enriched;
}

async function processOpportunities(
  opportunities: EnrichedOpportunity[],
  client: OutboundClient,
  rateLimitMs: number
): Promise<{ created: number; skipped: number; failed: number }> {
  const stats = { created: 0, skipped: 0, failed: 0 };

  for (const opp of opportunities) {
    const payload: SignalPayload = {
      // Core fields
      opportunityId: opp.id,
      companyName: opp.company,
      jobTitle: opp.title,
      metro: opp.metro,
      postedDate: opp.postedDate,
      description: opp.description,
      sourceUrl: opp.url,

      // Enriched fields
      fullDescription: opp.fullDescription,
      companyMetadata: opp.companyMetadata,
      contacts: opp.contacts,
      executiveMoves: opp.executiveMoves,
      relatedOpportunities: opp.relatedOpportunities,
      enrichmentStatus: opp.enrichmentStatus,
      enrichmentError: opp.enrichmentError,

      // Raw payload with all data
      rawPayload: { ...opp },
    };

    try {
      const result = await client.createSignal(payload);
      if (result) {
        stats.created++;
      } else {
        stats.skipped++; // Already exists or dry run
      }
    } catch (error) {
      console.error(`Failed to create signal for ${opp.company}:`, error);
      stats.failed++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, rateLimitMs));
  }

  return stats;
}

async function main(): Promise<void> {
  console.log('=== Lead5 Scout Starting ===');
  console.log(`Time: ${new Date().toISOString()}`);

  // Load config
  let config: Config;
  try {
    config = loadConfig();
    console.log(`Config loaded: dryRun=${config.dryRun}, maxResults=${config.maxResults}`);
    console.log(`API URL: ${config.outboundApiUrl}`);
    console.log(`Lead5 Email: ${config.lead5Email ? 'set' : 'MISSING'}`);
  } catch (error) {
    console.error('Failed to load config:', error);
    process.exit(1);
  }

  // Initialize Outbound client
  const outboundClient = new OutboundClient({
    baseUrl: config.outboundApiUrl,
    apiKey: config.outboundApiKey,
    dryRun: config.dryRun,
  });

  // Test API connectivity FIRST before doing anything else
  console.log('Testing API connectivity...');
  try {
    const healthResp = await fetch(`${config.outboundApiUrl}/health`);
    console.log(`Health check: ${healthResp.status}`);
    if (!healthResp.ok) {
      throw new Error(`API health check failed: ${healthResp.status}`);
    }
  } catch (error) {
    console.error('API connectivity failed:', error);
    // Continue anyway - we want to try
  }

  // Report start (for debugging on Render)
  await outboundClient.reportStatus('starting', {
    dryRun: config.dryRun,
    maxResults: config.maxResults,
    apiUrl: config.outboundApiUrl,
  });

  // Launch browser
  let browser: Browser | null = null;
  try {
    console.log('Launching browser...');
    await outboundClient.reportStatus('launching_browser');

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',  // Prevents crashes in Docker containers
        '--disable-gpu',
        '--single-process',  // More stable in containers
      ],
    });

    await outboundClient.reportStatus('browser_launched');

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });

    const page = await context.newPage();

    // Login
    await outboundClient.reportStatus('logging_in');
    const loggedIn = await login(page, config);
    if (!loggedIn) {
      await outboundClient.reportStatus('error:login_failed');
      throw new Error('Failed to login to Lead5');
    }
    await outboundClient.reportStatus('login_successful');

    // Navigate to search
    await outboundClient.reportStatus('navigating_to_search');
    await navigateToSearch(page);

    // Extract opportunities from search results
    await outboundClient.reportStatus('extracting_opportunities');
    const opportunities = await extractOpportunities(page, config.maxResults);
    console.log(`Extracted ${opportunities.length} opportunities`);
    await outboundClient.reportStatus('extraction_complete', { count: opportunities.length });

    if (opportunities.length === 0) {
      console.log('No opportunities found. The page structure may have changed.');
      console.log('Taking screenshot for debugging...');
      await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
    }

    // Enrich opportunities with detail page data
    await outboundClient.reportStatus('enriching_opportunities');
    const enrichedOpportunities = await enrichOpportunities(page, opportunities, config.rateLimitMs);
    await outboundClient.reportStatus('enrichment_complete', {
      total: enrichedOpportunities.length,
      success: enrichedOpportunities.filter(e => e.enrichmentStatus === 'success').length,
      failed: enrichedOpportunities.filter(e => e.enrichmentStatus === 'failed').length,
      skipped: enrichedOpportunities.filter(e => e.enrichmentStatus === 'skipped').length,
    });

    // Process enriched opportunities → create signals
    await outboundClient.reportStatus('processing_opportunities');
    const stats = await processOpportunities(enrichedOpportunities, outboundClient, config.rateLimitMs);

    console.log('\n=== Scout Run Complete ===');
    console.log(`Created: ${stats.created}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Total processed: ${opportunities.length}`);

    await outboundClient.reportStatus('completed', {
      created: stats.created,
      skipped: stats.skipped,
      failed: stats.failed,
      total: opportunities.length,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Scout error:', error);

    // Try to report the error
    try {
      await outboundClient.reportStatus('error:exception', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
    } catch {
      // Ignore if we can't report
    }

    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run
main().catch(console.error);
