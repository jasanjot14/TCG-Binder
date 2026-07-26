import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CardCandidate, CollectionCard } from '../types/card';

const STORAGE_KEY = '@tcgbinder/collection-v1';
const LEGACY_STORAGE_KEY = '@cardvault/collection-v4-ai';

type Finish = { key?: string; label?: string };
type GradeSelection = { key: string; label: string; company: string; grade: string } | null;
type ContextValue = {
  collection: CollectionCard[];
  isLoading: boolean;
  totalCards: number;
  addCard: (card: CardCandidate) => void;
  removeCard: (ownershipId: string) => void;
  updateOwnedFinish: (ownershipId: string, finish: Finish) => void;
  updateOwnedGrade: (ownershipId: string, grade: GradeSelection) => void;
  splitOneCopy: (ownershipId: string, finish: Finish) => void;
  splitOneForSeparateGrade: (ownershipId: string) => void;
  clearCollection: () => void;
};

const CollectionContext = createContext<ContextValue | null>(null);

function createOwnershipId(cardId: string) {
  return `${cardId}::${Date.now()}::${Math.random().toString(36).slice(2, 9)}`;
}

function finishKey(finish?: string) {
  return finish ?? '__unassigned__';
}

function gradeKey(grade?: string) {
  return grade ?? '__raw__';
}

function migrateStoredCards(raw: unknown): CollectionCard[] {
  if (!Array.isArray(raw)) return [];
  const normalized = raw.map((entry, index) => {
    const card = entry as CollectionCard & { ownershipId?: string; ownedConditionKey?: string; ownedConditionLabel?: string };
    const { ownedConditionKey: _unusedConditionKey, ownedConditionLabel: _unusedConditionLabel, ...cleanCard } = card;
    return {
      ...cleanCard,
      ownershipId: card.ownershipId ?? `${card.id}::legacy::${index}`,
    } as CollectionCard;
  });

  return normalized.reduce<CollectionCard[]>((merged, card) => {
    const existing = merged.find((item) => item.id === card.id
      && finishKey(item.ownedFinishKey) === finishKey(card.ownedFinishKey)
      && gradeKey(item.ownedGradeKey) === gradeKey(card.ownedGradeKey));
    if (existing) {
      existing.quantity += card.quantity;
      if (new Date(card.addedAt).getTime() > new Date(existing.addedAt).getTime()) existing.addedAt = card.addedAt;
      return merged;
    }
    return [...merged, card];
  }, []);
}

function findMatchingStack(cards: CollectionCard[], sourceId: string, id: string, finish?: string, grade?: string) {
  return cards.find((card) => card.ownershipId !== sourceId && card.id === id
    && finishKey(card.ownedFinishKey) === finishKey(finish)
    && gradeKey(card.ownedGradeKey) === gradeKey(grade));
}

export function CollectionProvider({ children }: { children: ReactNode }) {
  const [collection, setCollection] = useState<CollectionCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadCollection() {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        const legacyStored = stored ? null : await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        const value = stored ?? legacyStored;
        if (value) {
          const migrated = migrateStoredCards(JSON.parse(value));
          setCollection(migrated);
          if (!stored && legacyStored) {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          }
        }
      } catch {
      } finally {
        setIsLoading(false);
      }
    }
    loadCollection();
  }, []);

  useEffect(() => {
    if (!isLoading) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(collection)).catch(() => undefined);
  }, [collection, isLoading]);

  function addCard(candidate: CardCandidate) {
    setCollection((existing) => {
      const unassignedRaw = existing.find((card) => card.id === candidate.id && !card.ownedFinishKey && !card.ownedGradeKey);
      if (unassignedRaw) {
        return existing.map((card) => card.ownershipId === unassignedRaw.ownershipId ? { ...card, quantity: card.quantity + 1 } : card);
      }
      return [{ ...candidate, ownershipId: createOwnershipId(candidate.id), quantity: 1, addedAt: new Date().toISOString() }, ...existing];
    });
  }

  function updateOwnedFinish(ownershipId: string, finish: Finish) {
    setCollection((existing) => {
      const target = existing.find((card) => card.ownershipId === ownershipId);
      if (!target) return existing;
      const destination = findMatchingStack(existing, ownershipId, target.id, finish.key, target.ownedGradeKey);
      if (destination) {
        return existing
          .filter((card) => card.ownershipId !== ownershipId)
          .map((card) => card.ownershipId === destination.ownershipId ? { ...card, quantity: card.quantity + target.quantity } : card);
      }
      return existing.map((card) => card.ownershipId === ownershipId ? { ...card, ownedFinishKey: finish.key, ownedFinishLabel: finish.label } : card);
    });
  }


  function updateOwnedGrade(ownershipId: string, selection: GradeSelection) {
    setCollection((existing) => {
      const target = existing.find((card) => card.ownershipId === ownershipId);
      if (!target) return existing;
      const key = selection?.key;
      const destination = findMatchingStack(existing, ownershipId, target.id, target.ownedFinishKey, key);
      if (destination) {
        return existing
          .filter((card) => card.ownershipId !== ownershipId)
          .map((card) => card.ownershipId === destination.ownershipId ? { ...card, quantity: card.quantity + target.quantity } : card);
      }
      return existing.map((card) => card.ownershipId === ownershipId ? {
        ...card,
        ownedGradeKey: selection?.key,
        ownedGradeLabel: selection?.label,
        ownedGradeCompany: selection?.company,
        ownedGrade: selection?.grade,
      } : card);
    });
  }

  function splitOneCopy(ownershipId: string, finish: Finish) {
    setCollection((existing) => {
      const source = existing.find((card) => card.ownershipId === ownershipId);
      if (!source || source.quantity < 2 || finishKey(source.ownedFinishKey) === finishKey(finish.key)) return existing;
      const destination = findMatchingStack(existing, ownershipId, source.id, finish.key, source.ownedGradeKey);
      const remaining = existing.map((card) => card.ownershipId === ownershipId ? { ...card, quantity: card.quantity - 1 } : card);
      if (destination) {
        return remaining.map((card) => card.ownershipId === destination.ownershipId ? { ...card, quantity: card.quantity + 1 } : card);
      }
      return [{ ...source, ownershipId: createOwnershipId(source.id), quantity: 1, addedAt: new Date().toISOString(), ownedFinishKey: finish.key, ownedFinishLabel: finish.label }, ...remaining];
    });
  }


  function splitOneForSeparateGrade(ownershipId: string) {
    setCollection((existing) => {
      const source = existing.find((card) => card.ownershipId === ownershipId);
      if (!source || source.quantity < 2) return existing;
      const remaining = existing.map((card) => card.ownershipId === ownershipId ? { ...card, quantity: card.quantity - 1 } : card);
      const separated: CollectionCard = {
        ...source,
        ownershipId: createOwnershipId(source.id),
        quantity: 1,
        addedAt: new Date().toISOString(),
        ownedGradeKey: undefined,
        ownedGradeLabel: undefined,
        ownedGradeCompany: undefined,
        ownedGrade: undefined,
      };
      return [separated, ...remaining];
    });
  }

  const value = useMemo(() => ({
    collection,
    isLoading,
    totalCards: collection.reduce((sum, card) => sum + card.quantity, 0),
    addCard,
    removeCard: (ownershipId: string) => setCollection((cards) => cards.filter((card) => card.ownershipId !== ownershipId)),
    updateOwnedFinish,
    updateOwnedGrade,
    splitOneCopy,
    splitOneForSeparateGrade,
    clearCollection: () => setCollection([]),
  }), [collection, isLoading]);

  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>;
}

export function useCollection() {
  const context = useContext(CollectionContext);
  if (!context) throw new Error('CollectionProvider is missing.');
  return context;
}
