/**
 * Cleanup script to remove all Lead5-related data from HubSpot
 *
 * Order of deletion:
 * 1. Deals (to remove associations first)
 * 2. Contacts (PE contacts and company contacts we created)
 * 3. Companies (portfolio companies and PE firms we created)
 *
 * Run: HUBSPOT_ACCESS_TOKEN=... DRY_RUN=true npx tsx scripts/cleanup-hubspot.ts
 */

import 'dotenv/config';

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const DRY_RUN = process.env.DRY_RUN !== 'false';

if (!HUBSPOT_ACCESS_TOKEN) {
  console.error('HUBSPOT_ACCESS_TOKEN not set');
  process.exit(1);
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function hubspotRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(`https://api.hubapi.com${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HubSpot API error: ${response.status} - ${error}`);
  }

  return response.json();
}

async function searchDeals(): Promise<Array<{id: string, name: string}>> {
  const data = await hubspotRequest('/crm/v3/objects/deals/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'source_details',
          operator: 'EQ',
          value: 'Lead5 Scout',
        }],
      }],
      properties: ['dealname', 'source_details'],
      limit: 100,
    }),
  });

  return data.results.map((d: any) => ({ id: d.id, name: d.properties.dealname }));
}

async function getDealContacts(dealId: string): Promise<string[]> {
  try {
    const data = await hubspotRequest(`/crm/v4/objects/deals/${dealId}/associations/contacts`);
    return data.results.map((r: any) => String(r.toObjectId));
  } catch {
    return [];
  }
}

async function getDealCompanies(dealId: string): Promise<string[]> {
  try {
    const data = await hubspotRequest(`/crm/v4/objects/deals/${dealId}/associations/companies`);
    return data.results.map((r: any) => String(r.toObjectId));
  } catch {
    return [];
  }
}

async function deleteDeal(dealId: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete deal ${dealId}`);
    return;
  }

  await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}` },
  });
}

async function deleteContact(contactId: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete contact ${contactId}`);
    return;
  }

  await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}` },
  });
}

async function deleteCompany(companyId: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete company ${companyId}`);
    return;
  }

  await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${companyId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}` },
  });
}

async function main() {
  console.log('=== HubSpot Lead5 Data Cleanup ===');
  console.log(`Dry Run: ${DRY_RUN}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // 1. Find all Lead5 deals
  console.log('Step 1: Finding Lead5 Scout deals...');
  const deals = await searchDeals();
  console.log(`  Found ${deals.length} deals\n`);

  // Collect all associated contacts and companies
  const contactIds = new Set<string>();
  const companyIds = new Set<string>();

  console.log('Step 2: Collecting associated contacts and companies...');
  for (const deal of deals) {
    console.log(`  Processing deal: ${deal.name}`);

    const contacts = await getDealContacts(deal.id);
    contacts.forEach(id => contactIds.add(id));
    console.log(`    Contacts: ${contacts.length}`);

    const companies = await getDealCompanies(deal.id);
    companies.forEach(id => companyIds.add(id));
    console.log(`    Companies: ${companies.length}`);

    await delay(200);
  }

  console.log(`\nTotal unique contacts to delete: ${contactIds.size}`);
  console.log(`Total unique companies to delete: ${companyIds.size}\n`);

  // 3. Delete deals first (removes associations)
  console.log('Step 3: Deleting deals...');
  for (const deal of deals) {
    console.log(`  Deleting deal: ${deal.name} (${deal.id})`);
    await deleteDeal(deal.id);
    await delay(200);
  }
  console.log(`  Deleted ${deals.length} deals\n`);

  // 4. Delete contacts
  console.log('Step 4: Deleting contacts...');
  let contactsDeleted = 0;
  for (const contactId of contactIds) {
    console.log(`  Deleting contact: ${contactId}`);
    try {
      await deleteContact(contactId);
      contactsDeleted++;
    } catch (error) {
      console.log(`    Warning: Could not delete contact ${contactId}`);
    }
    await delay(200);
  }
  console.log(`  Deleted ${contactsDeleted} contacts\n`);

  // 5. Delete companies
  console.log('Step 5: Deleting companies...');
  let companiesDeleted = 0;
  for (const companyId of companyIds) {
    console.log(`  Deleting company: ${companyId}`);
    try {
      await deleteCompany(companyId);
      companiesDeleted++;
    } catch (error) {
      console.log(`    Warning: Could not delete company ${companyId}`);
    }
    await delay(200);
  }
  console.log(`  Deleted ${companiesDeleted} companies\n`);

  console.log('=== Cleanup Complete ===');
  console.log(`Deals deleted: ${deals.length}`);
  console.log(`Contacts deleted: ${contactsDeleted}`);
  console.log(`Companies deleted: ${companiesDeleted}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes were made. Set DRY_RUN=false to apply.');
  }
}

main().catch(console.error);
