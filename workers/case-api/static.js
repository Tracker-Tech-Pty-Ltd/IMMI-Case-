/** Static IMMI API data used by the standalone Cloudflare Worker.
 *
 * This module intentionally has no database or legacy proxy imports.  Values
 * mirror the public shapes previously served by the Worker/Flask boundary.
 */

export const VISA_FAMILIES = Object.freeze({
  Protection: "Refugee and humanitarian protection visas",
  Skilled: "Skilled migration and employer-sponsored visas",
  Student: "Student and education visas",
  Partner: "Partner, spouse, and de facto visas",
  Parent: "Parent and family reunion visas",
  Visitor: "Tourist, visitor, and temporary activity visas",
  Business: "Business innovation and investment visas",
  Bridging: "Bridging visas (temporary stay while substantive visa processed)",
  Other: "Other visa categories",
});

const VISA_ENTRIES = [
  ["866", "Protection", "Protection"], ["785", "Temporary Protection", "Protection"],
  ["790", "Safe Haven Enterprise", "Protection"], ["200", "Refugee (Permanent)", "Protection"],
  ["201", "In-Country Special Humanitarian (Permanent)", "Protection"],
  ["202", "Global Special Humanitarian (Permanent)", "Protection"],
  ["203", "Emergency Rescue", "Protection"], ["204", "Woman at Risk", "Protection"],
  ["786", "Temporary (Humanitarian Concern)", "Protection"], ["449", "Humanitarian Stay (Temporary)", "Protection"],
  ["189", "Skilled Independent", "Skilled"], ["190", "Skilled Nominated", "Skilled"],
  ["191", "Permanent Residence (Skilled Regional)", "Skilled"],
  ["186", "Employer Nomination Scheme", "Skilled"], ["187", "Regional Sponsored Migration Scheme", "Skilled"],
  ["457", "Temporary Work (Skilled)", "Skilled"], ["482", "Temporary Skill Shortage", "Skilled"],
  ["494", "Skilled Employer Sponsored Regional (Provisional)", "Skilled"],
  ["491", "Skilled Work Regional (Provisional)", "Skilled"],
  ["476", "Skilled - Recognised Graduate", "Skilled"], ["485", "Temporary Graduate", "Skilled"],
  ["489", "Skilled Regional (Provisional)", "Skilled"], ["407", "Training", "Skilled"],
  ["408", "Temporary Activity", "Skilled"], ["500", "Student", "Student"],
  ["590", "Student Guardian", "Student"], ["570", "Independent ELICOS Sector", "Student"],
  ["571", "Schools Sector", "Student"], ["572", "Vocational Education and Training Sector", "Student"],
  ["573", "Higher Education Sector", "Student"], ["574", "Postgraduate Research Sector", "Student"],
  ["575", "Non-award Sector", "Student"], ["576", "AusAID or Defence Sector", "Student"],
  ["309", "Partner (Provisional)", "Partner"], ["820", "Partner (Temporary)", "Partner"],
  ["801", "Partner (Permanent)", "Partner"], ["100", "Partner (Migrant)", "Partner"],
  ["300", "Prospective Marriage", "Partner"],
  ["461", "New Zealand Citizen Family Relationship (Temporary)", "Partner"],
  ["103", "Parent", "Parent"], ["143", "Contributory Parent", "Parent"],
  ["173", "Contributory Parent (Temporary)", "Parent"], ["804", "Aged Parent", "Parent"],
  ["884", "Contributory Aged Parent (Temporary)", "Parent"], ["864", "Contributory Aged Parent", "Parent"],
  ["600", "Visitor", "Visitor"], ["601", "Electronic Travel Authority", "Visitor"],
  ["651", "eVisitor", "Visitor"], ["400", "Temporary Work (Short Stay Activity)", "Visitor"],
  ["417", "Working Holiday", "Visitor"], ["462", "Work and Holiday", "Visitor"],
  ["188", "Business Innovation and Investment (Provisional)", "Business"],
  ["888", "Business Innovation and Investment (Permanent)", "Business"],
  ["132", "Business Talent (Permanent)", "Business"], ["891", "Investor", "Business"],
  ["892", "State/Territory Sponsored Business Owner", "Business"],
  ["893", "State/Territory Sponsored Senior Executive", "Business"],
  ["010", "Bridging A", "Bridging"], ["020", "Bridging B", "Bridging"],
  ["030", "Bridging C", "Bridging"], ["040", "Bridging D", "Bridging"],
  ["050", "Bridging (General)", "Bridging"], ["051", "Bridging (Protection Visa Applicant)", "Bridging"],
  ["060", "Bridging E", "Bridging"], ["070", "Bridging (Removal Pending)", "Bridging"],
  ["080", "Bridging (Crew)", "Bridging"], ["101", "Child", "Other"],
  ["102", "Adoption", "Other"], ["802", "Child", "Other"], ["445", "Dependent Child", "Other"],
  ["155", "Resident Return", "Other"], ["157", "Resident Return (5 years)", "Other"],
  ["444", "Special Category (New Zealand citizen)", "Other"], ["116", "Carer", "Other"],
  ["117", "Orphan Relative", "Other"], ["114", "Aged Dependent Relative", "Other"],
  ["115", "Remaining Relative", "Other"], ["836", "Carer", "Other"],
  ["856", "Employer Nomination Scheme (ENS)", "Other"], ["858", "Distinguished Talent", "Other"],
];

export const VISA_REGISTRY_API = Object.freeze({
  entries: VISA_ENTRIES.map(([subclass, name, family]) => ({ subclass, name, family })),
  families: VISA_FAMILIES,
});

export const VISA_REGISTRY_RAW = Object.freeze(
  Object.fromEntries(VISA_ENTRIES.map(([subclass, name, family]) => [subclass, [name, family]])),
);

export const DATA_DICTIONARY_FIELDS = Object.freeze([
  { name: "case_id", type: "string", description: "SHA-256 hash (first 12 chars) of citation/URL/title", example: "a1b2c3d4e5f6" },
  { name: "citation", type: "string", description: "Official case citation", example: "[2024] AATA 1234" },
  { name: "title", type: "string", description: "Case title / party names", example: "Smith v Minister for Immigration" },
  { name: "court", type: "string", description: "Full court/tribunal name", example: "Administrative Appeals Tribunal" },
  { name: "court_code", type: "string", description: "Short court identifier", example: "AATA" },
  { name: "date", type: "string", description: "Decision date (DD Month YYYY)", example: "15 March 2024" },
  { name: "year", type: "integer", description: "Decision year", example: "2024" },
  { name: "url", type: "string", description: "AustLII or Federal Court URL", example: "https://www.austlii.edu.au/..." },
  { name: "judges", type: "string", description: "Judge(s) or tribunal member(s)", example: "Deputy President S Smith" },
  { name: "catchwords", type: "string", description: "Key legal topics from the case", example: "MIGRATION - visa cancellation..." },
  { name: "outcome", type: "string", description: "Decision outcome", example: "Dismissed" },
  { name: "visa_type", type: "string", description: "Visa subclass or category", example: "Subclass 866 Protection" },
  { name: "legislation", type: "string", description: "Referenced legislation", example: "Migration Act 1958 (Cth) s 501" },
  { name: "text_snippet", type: "string", description: "Short excerpt from case text", example: "The Tribunal finds that..." },
  { name: "full_text_path", type: "string", description: "Path to downloaded full text file", example: "downloaded_cases/case_texts/a1b2c3d4e5f6.txt" },
  { name: "source", type: "string", description: "Data source identifier", example: "austlii" },
  { name: "user_notes", type: "string", description: "User-added notes", example: "Important precedent for..." },
  { name: "tags", type: "string", description: "Comma-separated user tags", example: "review, important" },
  { name: "visa_subclass", type: "string", description: "Visa subclass number", example: "866" },
  { name: "visa_class_code", type: "string", description: "Visa class code letter", example: "XA" },
  { name: "case_nature", type: "string", description: "Nature/category of the case (LLM-extracted)", example: "Protection visa refusal" },
  { name: "legal_concepts", type: "string", description: "Key legal concepts (LLM-extracted)", example: "well-founded fear, complementary protection" },
]);

export const LEGISLATIONS_META = Object.freeze([
  { id: "migration-act-1958", title: "Migration Act 1958", austlii_id: "consol_act/ma1958118", shortcode: "MA1958", type: "Act", jurisdiction: "Commonwealth", description: "The primary legislation governing migration to, from and within Australia. Establishes visa framework, deportation procedures, and rights of non-citizens.", sections_count: 940, last_amended: "", last_scraped: "2026-02-23T01:31:14.777025+00:00" },
  { id: "migration-regulations-1994", title: "Migration Regulations 1994", austlii_id: "consol_reg/mr1994227", shortcode: "MR1994", type: "Regulation", jurisdiction: "Commonwealth", description: "Subordinate legislation made under the Migration Act 1958. Sets out detailed criteria for visa applications and processing.", sections_count: 394, last_amended: "", last_scraped: "2026-02-23T01:37:57.011519+00:00" },
  { id: "australian-citizenship-act-2007", title: "Australian Citizenship Act 2007", austlii_id: "consol_act/aca2007254", shortcode: "ACA2007", type: "Act", jurisdiction: "Commonwealth", description: "Governs the acquisition, loss, and cessation of Australian citizenship. Establishes pathways to citizenship and criteria for maintaining citizenship status.", sections_count: 84, last_amended: "", last_scraped: "2026-02-23T01:39:22.320048+00:00" },
  { id: "australian-border-force-act-2015", title: "Australian Border Force Act 2015", austlii_id: "consol_act/abfa2015225", shortcode: "ABFA2015", type: "Act", jurisdiction: "Commonwealth", description: "Establishes the Australian Border Force (ABF) and its functions. Governs border enforcement, customs, and immigration compliance operations.", sections_count: 60, last_amended: "", last_scraped: "2026-02-23T01:40:43.535717+00:00" },
  { id: "administrative-review-tribunal-act-2024", title: "Administrative Review Tribunal Act 2024", austlii_id: "consol_act/arta2024336", shortcode: "ARTA2024", type: "Act", jurisdiction: "Commonwealth", description: "Establishes the Administrative Review Tribunal (ART), replacing the AAT from October 2024 for merits review of migration decisions.", sections_count: 318, last_amended: "", last_scraped: "2026-02-23T02:11:45.133872+00:00" },
]);
