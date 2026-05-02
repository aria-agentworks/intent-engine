export interface RawLead {
  source: string;
  text: string;
  url: string | null;
  contact: string | null;
  subreddit: string | null;
  author: string | null;
  created_at: string;
}

export interface ScoredLead extends RawLead {
  id: string;
  intent_score: number;
  intent_label: string;
  saved: boolean;
}
