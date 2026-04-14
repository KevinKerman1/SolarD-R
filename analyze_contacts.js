// Script to fetch and analyze GoHighLevel contacts for website leads
// Run with: node analyze_contacts.js

const LOCATION_ID = '8uDfZwEms36rykE5axKL';
const TWO_MONTHS_AGO = new Date('2026-02-06T00:00:00Z').getTime();

// Website lead pattern
const WEBSITE_PATTERN = /Website Message:|Service:/;

// Dud indicators
const DUD_KEYWORDS = [
  'test', 'testing', 'spam', 'viagra', 'casino', 'loan', 'crypto',
  'asdf', 'xxx', 'click here', 'win now', 'congratulations',
  'nigerian prince', 'inheritance', 'urgent', 'limited time',
  'free money', 'make money fast'
];

const results = {
  totalContacts: 0,
  recentContacts: 0,
  websiteLeads: 0,
  duds: [],
  legitimate: [],
  errors: []
};

async function analyzeContact(contact) {
  try {
    // This would need to call the MCP tool to get full contact details
    // For now, just return the contact data we have
    return contact;
  } catch (error) {
    results.errors.push({ contactId: contact.id, error: error.message });
    return null;
  }
}

function isWebsiteLead(notes) {
  if (!notes) return false;
  return WEBSITE_PATTERN.test(notes);
}

function isDud(notes) {
  if (!notes) return true;

  const lowerNotes = notes.toLowerCase();

  // Check for dud keywords
  if (DUD_KEYWORDS.some(keyword => lowerNotes.includes(keyword))) {
    return true;
  }

  // Check for very short messages (< 10 chars is likely spam)
  const messageMatch = notes.match(/Website Message:\s*(.+?)(?=Service:|$)/s);
  if (messageMatch) {
    const message = messageMatch[1].trim();
    if (message.length < 10) return true;

    // Check for nonsensical or random characters
    if (/^[^a-zA-Z0-9\s]{5,}/.test(message)) return true;
  }

  return false;
}

function categorizeLead(contact, notes) {
  const category = {
    id: contact.id,
    name: contact.contactName,
    email: contact.email,
    phone: contact.phone,
    dateAdded: contact.dateAdded,
    notes: notes,
    isDud: isDud(notes)
  };

  if (category.isDud) {
    results.duds.push(category);
  } else {
    results.legitimate.push(category);
  }

  results.websiteLeads++;
}

console.log('Note: This script template shows the analysis logic.');
console.log('Actual contact fetching will be done via MCP tools.');
console.log('\nAnalysis criteria:');
console.log('- Website lead pattern: "Website Message:" AND "Service:"');
console.log('- Dud indicators: spam keywords, short messages (<10 chars), nonsensical text');
console.log('- Date range: Since February 6, 2026');
