export type CardCandidate = {
  id: string;
  game: 'pokemon';
  name: string;
  setName: string;
  cardNumber: string;
  rarity: string;
  imageUrl: string;
};

export type CollectionCard = CardCandidate & {
  ownershipId: string;
  quantity: number;
  addedAt: string;
  ownedFinishKey?: string;
  ownedFinishLabel?: string;
  ownedGradeKey?: string;
  ownedGradeLabel?: string;
  ownedGradeCompany?: string;
  ownedGrade?: string;
};

export type AiExtraction = {
  isTradingCard: boolean;
  game: 'pokemon' | 'one_piece' | 'other' | 'unknown';
  cardName: string;
  cardNumber: string;
  setHint: string;
  confidence: number;
  visibleNotes: string;
};

export type IdentifyResponse = {
  success: true;
  candidate: CardCandidate;
  extraction: AiExtraction;
  matchQuality: 'exact-number' | 'name-only';
  matchSource?: 'apple-vision-ocr' | 'manual-search';
};
