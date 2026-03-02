import { MONETIZATION_OFFERS, type MonetizationOffer } from '@/content/monetization/offers';

type PostLike = {
  slug: string;
  data: {
    title: string;
    tags: string[];
    category?: string;
  };
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function scoreOffer(post: PostLike, offer: MonetizationOffer) {
  const haystack = [post.data.title, ...(post.data.tags ?? []), post.data.category ?? '']
    .map((v) => normalize(String(v)))
    .join(' ');

  let score = 0;
  for (const tag of offer.tags) {
    if (haystack.includes(normalize(tag))) score += 2;
  }
  if (offer.category && normalize(offer.category) === normalize(post.data.category ?? '')) {
    score += 3;
  }
  return score;
}

export function getOffersForPost(post: PostLike, limit = 2) {
  return [...MONETIZATION_OFFERS]
    .map((offer) => ({ offer, score: scoreOffer(post, offer) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.offer);
}

