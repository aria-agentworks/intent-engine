export interface SourceProfile {
  karma: number | null;
  account_age_days: number | null;
  bio: string | null;
  website: string | null;
  profile_url: string | null;
}

export interface EnrichmentResult {
  lead_id: string;
  emails: string[];
  phones: string[];
  urls: string[];
  company: string | null;
  source_profile: SourceProfile | null;
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const URL_RE = /https?:\/\/[^\s)<>"]+/g;

function extractFromText(text: string) {
  const emails = [...new Set(text.match(EMAIL_RE) ?? [])];
  const phones = [...new Set(text.match(PHONE_RE) ?? [])];
  const rawUrls = [...new Set(text.match(URL_RE) ?? [])];
  const urls = rawUrls.map((u) => u.replace(/[.,;:!?)]+$/, ""));
  return { emails, phones, urls };
}

function companyFromUrls(urls: string[], emails: string[]): string | null {
  for (const u of urls) {
    try {
      const { hostname } = new URL(u);
      if (
        !hostname.includes("reddit.com") &&
        !hostname.includes("ycombinator.com") &&
        !hostname.includes("news.ycombinator.com") &&
        !hostname.includes("github.com") &&
        !hostname.includes("twitter.com") &&
        !hostname.includes("t.co") &&
        !hostname.includes("bit.ly")
      ) {
        const parts = hostname.replace(/^www\./, "").split(".");
        if (parts.length >= 2) {
          return parts[parts.length - 2];
        }
      }
    } catch {
      // ignore malformed URLs
    }
  }
  for (const email of emails) {
    const domain = email.split("@")[1];
    if (domain && !domain.includes("gmail") && !domain.includes("yahoo") && !domain.includes("hotmail") && !domain.includes("outlook")) {
      return domain.split(".")[0];
    }
  }
  return null;
}

async function fetchRedditProfile(author: string): Promise<SourceProfile | null> {
  try {
    const res = await fetch(`https://www.reddit.com/user/${author}/about.json`, {
      headers: { "User-Agent": "IntentEngine/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: { total_karma?: number; link_karma?: number; comment_karma?: number; created_utc?: number; icon_img?: string; subreddit?: { public_description?: string; display_name?: string } } };
    const d = json.data;
    if (!d) return null;
    const ageDays = d.created_utc
      ? Math.floor((Date.now() / 1000 - d.created_utc) / 86400)
      : null;
    return {
      karma: (d.total_karma ?? (d.link_karma ?? 0) + (d.comment_karma ?? 0)) || null,
      account_age_days: ageDays,
      bio: d.subreddit?.public_description?.trim() || null,
      website: null,
      profile_url: `https://reddit.com/u/${author}`,
    };
  } catch {
    return null;
  }
}

async function fetchHNProfile(author: string): Promise<SourceProfile | null> {
  try {
    const res = await fetch(
      `https://hacker-news.firebaseio.com/v0/user/${author}.json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const d = await res.json() as { karma?: number; created?: number; about?: string } | null;
    if (!d) return null;
    const ageDays = d.created
      ? Math.floor((Date.now() / 1000 - d.created) / 86400)
      : null;

    // HN about field is HTML-encoded; extract plain text and URLs
    const rawAbout = d.about ?? "";
    const aboutText = rawAbout.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").trim();
    const websiteMatch = rawAbout.match(/href="([^"]+)"/);
    const website = websiteMatch ? websiteMatch[1] : null;

    return {
      karma: d.karma ?? null,
      account_age_days: ageDays,
      bio: aboutText || null,
      website,
      profile_url: `https://news.ycombinator.com/user?id=${author}`,
    };
  } catch {
    return null;
  }
}

export async function enrichLead(
  leadId: string,
  text: string,
  source: string,
  author: string | null
): Promise<EnrichmentResult> {
  const { emails, phones, urls } = extractFromText(text);

  let profile: SourceProfile | null = null;
  if (author) {
    const s = source.toLowerCase();
    if (s.includes("reddit")) {
      profile = await fetchRedditProfile(author);
    } else if (s === "hacker_news" || s.includes("hacker")) {
      profile = await fetchHNProfile(author);
      // also pull emails/URLs from the HN bio
      if (profile?.bio) {
        const fromBio = extractFromText(profile.bio);
        emails.push(...fromBio.emails);
        urls.push(...fromBio.urls);
      }
    }
  }

  const uniqueEmails = [...new Set(emails)];
  const uniqueUrls = [...new Set(urls)];
  const company = companyFromUrls(uniqueUrls, uniqueEmails);

  return {
    lead_id: leadId,
    emails: uniqueEmails,
    phones: [...new Set(phones)],
    urls: uniqueUrls,
    company,
    source_profile: profile,
  };
}
