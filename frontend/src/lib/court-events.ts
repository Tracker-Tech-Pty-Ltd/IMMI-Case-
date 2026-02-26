export interface CourtEvent {
  year: number;
  labelKey: string;
  labelDefault: string;
  color: string;
}

export const COURT_EVENTS: CourtEvent[] = [
  { year: 2013, labelKey: "lineage.event_fmca_fcca", labelDefault: "FMCA→FCCA", color: "#b9770e" },
  { year: 2015, labelKey: "lineage.event_rrta_aata", labelDefault: "RRTA+MRTA→AATA", color: "#4f81bd" },
  { year: 2021, labelKey: "lineage.event_fcca_fedcfam", labelDefault: "FCCA→FedCFamC2G", color: "#6c3483" },
  { year: 2024, labelKey: "lineage.event_aata_arta", labelDefault: "AATA→ARTA", color: "#70ad47" },
];
