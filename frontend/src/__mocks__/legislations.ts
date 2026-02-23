import type {
  Legislation,
  PaginatedLegislations,
  SearchLegislations,
  LegislationDetail,
} from "@/lib/api";

export const mockLegislations: Legislation[] = [
  {
    id: "migration-act-1958",
    title: "Migration Act 1958",
    austlii_id: "consol_act/ma1958116",
    shortcode: "MA",
    jurisdiction: "Commonwealth",
    type: "Act",
    description: "The primary legislation governing immigration to Australia",
    sections_count: 231,
    last_amended: "15 Jan 2024",
    last_scraped: "2026-02-20T10:00:00Z",
  },
  {
    id: "migration-regulations-1994",
    title: "Migration Regulations 1994",
    austlii_id: "consol_reg/mr1994227",
    shortcode: "MR",
    jurisdiction: "Commonwealth",
    type: "Regulation",
    description: "Regulations made under the Migration Act 1958",
    sections_count: 456,
    last_amended: "10 Mar 2025",
    last_scraped: "2026-02-20T10:05:00Z",
  },
  {
    id: "australian-citizenship-act-2007",
    title: "Australian Citizenship Act 2007",
    austlii_id: "consol_act/aca2007254",
    shortcode: "ACA2007",
    jurisdiction: "Commonwealth",
    type: "Act",
    description:
      "Legislation governing the acquisition and loss of Australian citizenship",
    sections_count: 134,
    last_amended: "20 October 2025",
    last_scraped: "2026-02-20T10:10:00Z",
  },
];

export const mockLegislationWithSections: Legislation = {
  ...mockLegislations[0],
  sections_count: 500,
  last_amended: "15 Jan 2024",
  last_scraped: "2023-12-01T00:00:00Z",
  sections: [
    {
      id: "s1",
      number: "1",
      title: "Short title",
      part: "Part 1—Preliminary",
      division: "",
      text: "This Act may be cited as the Migration Act 1958.",
    },
    {
      id: "s501",
      number: "501",
      title: "Character test",
      part: "Part 9—Deportation",
      division: "Division 2—Cancellation of visas",
      text: "The Minister may refuse to grant a visa to a person if the person does not pass the character test.",
    },
  ],
};

export const mockPaginatedLegislations: PaginatedLegislations = {
  success: true,
  data: mockLegislations.slice(0, 2),
  meta: {
    total: 3,
    pages: 2,
    page: 1,
    limit: 2,
  },
};

export const mockLegislationDetail: LegislationDetail = {
  success: true,
  data: mockLegislationWithSections,
};

export const mockSearchLegislations: SearchLegislations = {
  success: true,
  data: [mockLegislations[0]],
  meta: {
    query: "migration",
    total_results: 1,
    limit: 20,
  },
};

export const mockEmptyPaginatedLegislations: PaginatedLegislations = {
  success: true,
  data: [],
  meta: {
    total: 0,
    pages: 0,
    page: 1,
    limit: 20,
  },
};

export const mockEmptySearchLegislations: SearchLegislations = {
  success: true,
  data: [],
  meta: {
    query: "xyz",
    total_results: 0,
    limit: 20,
  },
};
