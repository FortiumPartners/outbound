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

interface PEContact {
  name: string;
  title: string;
  organization: string;
  email?: string;
  linkedIn?: string;
}

interface EnrichedOpportunity extends Opportunity {
  // Full description (not truncated)
  fullDescription?: string;

  // Company info
  companyMetadata?: CompanyMetadata;

  // Contacts at company
  contacts?: CompanyContact[];

  // PE investor contacts
  peContacts?: PEContact[];

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

  // Wait for navigation away from login page
  await page.waitForTimeout(5000);

  const currentUrl = page.url();
  console.log(`After login, URL: ${currentUrl}`);

  // Check if we're no longer on the login page
  if (currentUrl.includes('sign_in')) {
    console.error('Login failed - still on login page');
    return false;
  }

  // Accept various redirect destinations
  if (currentUrl.includes('lead5.com')) {
    console.log('Login successful');
    return true;
  }

  console.error('Login failed - unexpected redirect');
  return false;
}

async function navigateToSearch(page: Page): Promise<void> {
  console.log('Navigating to executive search...');

  // First, go to the Feed page (where login redirects)
  // Use domcontentloaded instead of load for Angular apps
  await page.goto('https://lead5.com/l5/app/#/l5/app/Feed', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Wait for Angular app to fully render
  await page.waitForTimeout(5000);

  // Click on "My5 Jobs" in sidebar to load search results
  // The element is a generic div, not a link, so we need multiple strategies
  console.log('Clicking My5 Jobs in sidebar...');

  let clicked = false;

  // Strategy 1: Click by exact text match (first occurrence in sidebar)
  try {
    const my5JobsElements = page.locator('text=My5 Jobs');
    const count = await my5JobsElements.count();
    console.log(`  Found ${count} "My5 Jobs" elements`);

    if (count > 0) {
      // Click the first one (sidebar menu item)
      await my5JobsElements.first().click({ timeout: 5000 });
      clicked = true;
      console.log('  ✓ Clicked My5 Jobs (first match)');
    }
  } catch (error) {
    console.log('  Strategy 1 failed:', (error as Error).message);
  }

  // Strategy 2: Find by role/accessibility
  if (!clicked) {
    try {
      await page.getByRole('button', { name: /My5 Jobs/i }).click({ timeout: 3000 });
      clicked = true;
      console.log('  ✓ Clicked My5 Jobs (button role)');
    } catch {
      console.log('  Strategy 2 failed: no button with My5 Jobs');
    }
  }

  // Strategy 3: Click any element containing the text in the sidebar/nav area
  if (!clicked) {
    try {
      await page.locator('[class*="sidebar"] >> text=My5 Jobs').first().click({ timeout: 3000 });
      clicked = true;
      console.log('  ✓ Clicked My5 Jobs (sidebar selector)');
    } catch {
      console.log('  Strategy 3 failed: no sidebar element');
    }
  }

  // Strategy 4: Use JavaScript to find and click
  if (!clicked) {
    try {
      const jsClicked = await page.evaluate(() => {
        const elements = document.querySelectorAll('*');
        for (const el of elements) {
          const text = el.textContent?.trim();
          // Find element where direct text is "My5 Jobs" (not nested)
          if (text === 'My5 Jobs' ||
              (el.childNodes.length === 1 &&
               el.childNodes[0].nodeType === Node.TEXT_NODE &&
               el.childNodes[0].textContent?.trim() === 'My5 Jobs')) {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
      if (jsClicked) {
        clicked = true;
        console.log('  ✓ Clicked My5 Jobs (JavaScript)');
      }
    } catch {
      console.log('  Strategy 4 failed: JS click failed');
    }
  }

  // Strategy 5: Navigate directly to Search URL as fallback
  if (!clicked) {
    console.log('  All click strategies failed, navigating directly to Search URL...');
    await page.goto('https://lead5.com/l5/app/#/l5/app/Search/1', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  }

  // Wait for search results to load
  await page.waitForTimeout(5000);

  // Verify we're on the search page
  const currentUrl = page.url();
  console.log(`Current URL: ${currentUrl}`);

  if (currentUrl.includes('Search')) {
    console.log('✓ Successfully navigated to search page');
  } else {
    console.log('⚠ May not be on search page, continuing anyway...');
  }
}

// === Helper Functions for Text Extraction ===

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50);
}

function extractCompanyFromText(title: string, cardText: string): string {
  // Pattern 1: "at Company Name" in title
  const atMatch = title.match(/\bat\s+([A-Z][^,\n]+?)(?:\s*(?:by|$))/i);
  if (atMatch) return atMatch[1].trim();

  // Pattern 2: "at CompanyName by Lead5" in card text
  const cardAtMatch = cardText.match(/at\s+([A-Z][^,\n]+?)\s+by\s+Lead5/i);
  if (cardAtMatch) return cardAtMatch[1].trim();

  // Pattern 3: "Potential CTO Opportunity at CompanyName"
  const potentialMatch = cardText.match(/Potential\s+\w+\s+Opportunity\s+at\s+([A-Z][^\n]+?)\s+by/i);
  if (potentialMatch) return potentialMatch[1].trim();

  return '';
}

function extractMetroFromText(cardText: string): string {
  const metroMatch = cardText.match(/Metro:\s*([A-Za-z\s]+?)(?:\s+Posted|$)/);
  return metroMatch ? metroMatch[1].trim() : '';
}

function extractDateFromText(cardText: string): string {
  const dateMatch = cardText.match(/Posted:\s*([A-Za-z]+\s+\d+,\s*\d{4})/);
  if (dateMatch) {
    const parsed = new Date(dateMatch[1]);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }
  return new Date().toISOString().split('T')[0];
}

// === Detail Page Data Extraction ===

interface DetailPageData {
  fullDescription?: string;
  company?: string;
  metro?: string;
  companyMetadata?: CompanyMetadata;
  contacts?: CompanyContact[];
  peContacts?: PEContact[];
  executiveMoves?: ExecutiveMove[];
  relatedOpportunities?: RelatedOpportunity[];
  enrichmentStatus: 'success' | 'failed' | 'skipped';
  enrichmentError?: string;
}

/**
 * Extract PE Contacts from the PE Investors and PE Contacts sections.
 * PE firm name comes from "PE Investors" section, contacts from "PE Contacts" section.
 * Note: PE Contacts have LinkedIn icons, NOT email icons (those are for Company Contacts).
 */
async function extractPEContacts(page: Page): Promise<PEContact[]> {
  const peContacts: PEContact[] = [];

  try {
    // Wait for Angular lazy loading
    await page.waitForTimeout(2000);

    // Extract PE firm name and contacts directly from the DOM
    const peData = await page.evaluate(() => {
      const result = {
        peFirmName: '',
        contacts: [] as Array<{ name: string; title: string; linkedInUrl: string | null }>,
      };

      const bodyText = document.body.textContent || '';

      // 1. Find PE Investors section to get PE firm name
      // The structure is: "PE Investors" header followed by firm name like "ICONIQ Capital"
      const peInvestorsMatch = bodyText.match(/PE Investors\s*([A-Z][\w\s&]+(?:Capital|Partners|Equity|Ventures|Group|Management|Advisors|Holdings))/i);
      if (peInvestorsMatch) {
        result.peFirmName = peInvestorsMatch[1].trim();
      }

      // 2. Check if PE Contacts section exists
      if (!bodyText.includes('PE Contacts')) {
        return result;
      }

      // 3. Find PE Contacts section in DOM
      const allElements = Array.from(document.querySelectorAll('*'));
      let peContactsHeader: Element | null = null;

      for (const el of allElements) {
        const text = el.textContent?.trim() || '';
        // Look for exact "PE Contacts" header (leaf node)
        if (text === 'PE Contacts' && el.children.length === 0) {
          peContactsHeader = el;
          break;
        }
      }

      if (!peContactsHeader) return result;

      // 4. Find the container (GDPeopleContainer) that holds the contacts
      let container = peContactsHeader.parentElement;
      for (let i = 0; i < 5 && container; i++) {
        if (container.classList.contains('GDPeopleContainer') ||
            container.querySelectorAll('.blackBoldText').length > 0) {
          break;
        }
        container = container.parentElement;
      }

      if (!container) return result;

      // 5. Extract each contact from the container
      // Each contact has: .blackBoldText for name, .grayText for title, .iconLinkedin for LinkedIn
      const contactRows = container.querySelectorAll('.d-flex.mb15p48px, [class*="mb15p"]');

      contactRows.forEach(row => {
        const nameEl = row.querySelector('.blackBoldText');
        const titleEl = row.querySelector('.grayText');
        const linkedInEl = row.querySelector('a.iconLinkedin, [class*="iconLinkedin"]');

        const name = nameEl?.textContent?.trim() || '';
        const title = titleEl?.textContent?.trim() || '';

        // Get LinkedIn URL - it's usually in an onclick or the parent link
        let linkedInUrl: string | null = null;
        if (linkedInEl) {
          // The LinkedIn icon might trigger a navigation or have href
          const parentLink = linkedInEl.closest('a[href*="linkedin"]');
          if (parentLink) {
            linkedInUrl = parentLink.getAttribute('href');
          }
        }

        if (name && name.length > 2 && name.length < 60) {
          result.contacts.push({ name, title, linkedInUrl });
        }
      });

      // Deduplicate by name
      const seen = new Set<string>();
      result.contacts = result.contacts.filter(c => {
        if (seen.has(c.name)) return false;
        seen.add(c.name);
        return true;
      });

      return result;
    });

    // Log what we found
    if (peData.peFirmName) {
      console.log(`    PE Firm: ${peData.peFirmName}`);
    } else {
      console.log('    No PE firm name found in PE Investors section');
    }

    if (peData.contacts.length === 0) {
      console.log('    No PE Contacts section or no contacts found');
      return peContacts;
    }

    console.log(`    Found ${peData.contacts.length} PE contacts`);

    // Convert to PEContact format
    for (const contact of peData.contacts) {
      peContacts.push({
        name: contact.name,
        title: contact.title,
        organization: peData.peFirmName, // Associate with the PE firm
        email: undefined, // PE Contacts don't have emails in this section
        linkedIn: contact.linkedInUrl || undefined,
      });
      console.log(`    PE Contact: ${contact.name} (${contact.title}) @ ${peData.peFirmName || 'Unknown PE Firm'}`);
    }

  } catch (error) {
    console.log(`    PE Contacts extraction failed: ${(error as Error).message}`);
  }

  return peContacts;
}

async function extractDetailPageData(page: Page, cardText: string): Promise<DetailPageData> {
  try {
    // 1. Basic page data via evaluate
    const pageData = await page.evaluate(() => {
      const result: {
        fullDescription?: string;
        company?: string;
        metro?: string;
        industry?: string;
        ownership?: string;
      } = {};

      const bodyText = document.body.textContent || '';

      // Try to get full description from main content area
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

      // Extract company metadata
      const industryMatch = bodyText.match(/Industry[:\s]+([^\n]+)/i);
      if (industryMatch) result.industry = industryMatch[1].trim().slice(0, 100);

      const ownershipMatch = bodyText.match(/Ownership[:\s]+([^\n]+)/i);
      if (ownershipMatch) result.ownership = ownershipMatch[1].trim().slice(0, 50);

      return result;
    });

    // 2. PE Contacts (requires clicking modals - cannot be done in page.evaluate)
    const peContacts = await extractPEContacts(page);

    return {
      fullDescription: pageData.fullDescription,
      companyMetadata: {
        industry: pageData.industry,
        ownership: pageData.ownership,
      },
      peContacts,
      enrichmentStatus: 'success',
    };
  } catch (error) {
    console.log(`    Warning: Could not extract detail page data: ${(error as Error).message}`);
    return {
      enrichmentStatus: 'failed',
      enrichmentError: (error as Error).message,
    };
  }
}

// === Main Opportunity Extraction (Click-Through Approach) ===

async function extractOpportunities(page: Page, maxResults: number): Promise<EnrichedOpportunity[]> {
  console.log('Extracting opportunities via click-through...');

  // Wait for Angular app to fully render
  await page.waitForTimeout(3000);

  // 1. Find all opportunity cards
  const opportunityCards = await page.evaluate(() => {
    const cards: { index: number; title: string; cardText: string }[] = [];
    const seenTitles = new Set<string>();

    document.querySelectorAll('.itemTitleBlack').forEach((el, index) => {
      const title = el.textContent?.trim() || '';
      if (title && !seenTitles.has(title) &&
          (title.includes('Vacancy') || title.includes('Chief') ||
           title.includes('CTO') || title.includes('CIO') ||
           title.includes('CFO') || title.includes('Opportunity'))) {
        seenTitles.add(title);

        // Get parent card text for company/metro extraction
        let parent = el.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          if (parent.textContent && parent.textContent.length > 200) break;
          parent = parent.parentElement;
        }
        cards.push({
          index,
          title,
          cardText: (parent?.textContent || '').slice(0, 2000),
        });
      }
    });

    return cards;
  });

  console.log(`Found ${opportunityCards.length} opportunity cards to process`);

  const opportunities: EnrichedOpportunity[] = [];
  const cardsToProcess = opportunityCards.slice(0, maxResults);

  // 2. Click each card to navigate to detail page
  for (let i = 0; i < cardsToProcess.length; i++) {
    const card = cardsToProcess[i];
    console.log(`  [${i + 1}/${cardsToProcess.length}] Processing: ${card.title.slice(0, 50)}...`);

    try {
      // Click the card
      const itemSelector = `.itemTitleBlack:has-text("${card.title.slice(0, 30)}")`;
      await page.locator(itemSelector).first().click({ timeout: 5000 });
      await page.waitForTimeout(3000);

      // Capture URL
      const detailUrl = page.url();
      console.log(`    URL: ${detailUrl}`);

      if (detailUrl.includes('ArticleDetails')) {
        // Extract ID from URL (alphanumeric, not just digits)
        const idMatch = detailUrl.match(/ArticleDetails\/([a-zA-Z0-9]+)/);
        const id = idMatch ? idMatch[1] : slugify(card.title);

        // Extract data while ON detail page
        const enrichedData = await extractDetailPageData(page, card.cardText);

        // Parse company/metro from card text
        const company = extractCompanyFromText(card.title, card.cardText);
        const metro = extractMetroFromText(card.cardText);
        const postedDate = extractDateFromText(card.cardText);

        // Clean up the title
        const cleanTitle = card.title.replace(/\s+by\s+Lead5.*$/i, '').trim();

        opportunities.push({
          id,
          title: cleanTitle,
          company: company || enrichedData.company || 'Unknown Company',
          metro: metro || enrichedData.metro || '',
          postedDate,
          description: enrichedData.fullDescription?.slice(0, 500) || '',
          url: detailUrl,
          fullDescription: enrichedData.fullDescription,
          companyMetadata: enrichedData.companyMetadata,
          contacts: enrichedData.contacts,
          peContacts: enrichedData.peContacts,
          executiveMoves: enrichedData.executiveMoves,
          relatedOpportunities: enrichedData.relatedOpportunities,
          enrichmentStatus: enrichedData.enrichmentStatus,
          enrichmentError: enrichedData.enrichmentError,
        });

        console.log(`    OK Extracted: ${cleanTitle.slice(0, 40)} (${company || 'Unknown'})`);
      } else {
        console.log(`    Warning: Not a detail page, skipping`);
      }

      // Go back to search results
      await page.goBack();
      await page.waitForTimeout(2000);

    } catch (error) {
      console.log(`    Failed: ${(error as Error).message}`);
      // Continue to next card on error
    }
  }

  console.log(`Extracted ${opportunities.length} opportunities`);
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

    // Extract opportunities from search results (enrichment happens during click-through)
    await outboundClient.reportStatus('extracting_opportunities');
    const enrichedOpportunities = await extractOpportunities(page, config.maxResults);
    console.log(`Extracted ${enrichedOpportunities.length} opportunities`);
    await outboundClient.reportStatus('extraction_complete', {
      count: enrichedOpportunities.length,
      success: enrichedOpportunities.filter(e => e.enrichmentStatus === 'success').length,
      failed: enrichedOpportunities.filter(e => e.enrichmentStatus === 'failed').length,
      skipped: enrichedOpportunities.filter(e => e.enrichmentStatus === 'skipped').length,
    });

    if (enrichedOpportunities.length === 0) {
      console.log('No opportunities found. The page structure may have changed.');
      console.log('Taking screenshot for debugging...');
      await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
    }

    // Process enriched opportunities → create signals
    await outboundClient.reportStatus('processing_opportunities');
    const stats = await processOpportunities(enrichedOpportunities, outboundClient, config.rateLimitMs);

    console.log('\n=== Scout Run Complete ===');
    console.log(`Created: ${stats.created}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Total processed: ${enrichedOpportunities.length}`);

    await outboundClient.reportStatus('completed', {
      created: stats.created,
      skipped: stats.skipped,
      failed: stats.failed,
      total: enrichedOpportunities.length,
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
