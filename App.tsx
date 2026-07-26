import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView,
  SafeAreaView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { CardTile } from './src/components/CardTile';
import { PrimaryButton } from './src/components/PrimaryButton';
import { CollectionProvider, useCollection } from './src/context/CollectionContext';
import type { AiExtraction, CardCandidate, CollectionCard, IdentifyResponse } from './src/types/card';
import { Ionicons } from '@expo/vector-icons';

type Screen = 'collection' | 'camera' | 'review' | 'identifying' | 'confirm' | 'settings' | 'manualSearch' | 'details';
type CapturedPhoto = { uri: string; base64: string; width: number; height: number };
type PriceVariant = {
  key: string;
  label: string;
  lowPrice: number | null;
  marketPrice: number | null;
  midPrice: number | null;
  directLowPrice: number | null;
};
type CollectionFilter = 'all' | 'needs-finish' | 'ungraded' | 'graded' | 'duplicates' | 'no-price';
type SortOption = 'recent' | 'highest-value' | 'name' | 'set' | 'quantity';
type DetailPricingTab = 'ungraded' | 'graded' | null;
type CardPricingResponse = {
  success: true;
  dataAvailable: boolean;
  source: string;
  provider: string;
  unit: string;
  updated: string | null;
  variants: PriceVariant[];
  notice: string;
};
type GradedPriceRow = {
  key: string;
  label: string;
  company: string;
  grade: string;
  medianPrice: number;
  sampleSize: number | null;
};
type GradedPricingResponse = {
  success: true;
  configured: boolean;
  dataAvailable: boolean;
  provider: string;
  unit: string;
  rows: GradedPriceRow[];
  notice: string;
  matchedName?: string | null;
  matchedNumber?: string | null;
};

const SERVER_URL_KEY = '@tcgbinder/server-url';
const GRID_COLUMNS_KEY = '@tcgbinder/grid-columns';
const FINISH_FILTER_KEY = '@tcgbinder/collection-filter';
const SORT_OPTION_KEY = '@tcgbinder/sort-option';
const LEGACY_SERVER_URL_KEY = '@cardvault/server-url';
const LEGACY_GRID_COLUMNS_KEY = '@cardvault/grid-columns';
const LEGACY_FINISH_FILTER_KEY = '@cardvault/collection-filter';
const LEGACY_SORT_OPTION_KEY = '@cardvault/sort-option';

async function getSavedSetting(key: string, legacyKey: string) {
  const saved = await AsyncStorage.getItem(key);
  if (saved) return saved;
  const legacySaved = await AsyncStorage.getItem(legacyKey);
  if (legacySaved) {
    await AsyncStorage.setItem(key, legacySaved);
    return legacySaved;
  }
  return null;
}

export default function App() {
  return <CollectionProvider><TCGBinderApp /></CollectionProvider>;
}

function TCGBinderApp() {
  const { collection, isLoading, totalCards, addCard, removeCard, updateOwnedFinish, updateOwnedGrade, splitOneCopy, splitOneForSeparateGrade, clearCollection } = useCollection();
  const [screen, setScreen] = useState<Screen>('collection');
  const [query, setQuery] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [candidate, setCandidate] = useState<CardCandidate | null>(null);
  const [extraction, setExtraction] = useState<AiExtraction | null>(null);
  const [matchQuality, setMatchQuality] = useState<'exact-number' | 'name-only' | null>(null);
  const [matchSource, setMatchSource] = useState<'scan' | 'manual-search'>('scan');
  const [addedName, setAddedName] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [serverStatusMessage, setServerStatusMessage] = useState<string>('');
  const [selectedCard, setSelectedCard] = useState<CollectionCard | null>(null);
  const [pricing, setPricing] = useState<CardPricingResponse | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [gradedPricing, setGradedPricing] = useState<GradedPricingResponse | null>(null);
  const [gradedPricingLoading, setGradedPricingLoading] = useState(false);
  const [gradedPricingError, setGradedPricingError] = useState<string | null>(null);
  const [gradedCollectionPricing, setGradedCollectionPricing] = useState<Record<string, GradedPricingResponse>>({});
  const [collectionPricing, setCollectionPricing] = useState<Record<string, CardPricingResponse>>({});
  const [collectionPricingLoading, setCollectionPricingLoading] = useState(false);
  const [gridColumns, setGridColumns] = useState<1 | 2 | 3 | 4 | 5>(2);
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('recent');

  useEffect(() => {
    getSavedSetting(SERVER_URL_KEY, LEGACY_SERVER_URL_KEY).then((saved) => {
      if (saved) setServerUrl(saved);
    }).catch(() => undefined);
    getSavedSetting(GRID_COLUMNS_KEY, LEGACY_GRID_COLUMNS_KEY).then((saved) => {
      const parsed = Number(saved);
      if ([1, 2, 3, 4, 5].includes(parsed)) setGridColumns(parsed as 1 | 2 | 3 | 4 | 5);
    }).catch(() => undefined);
    getSavedSetting(FINISH_FILTER_KEY, LEGACY_FINISH_FILTER_KEY).then((saved) => {
      if (saved === 'all' || saved === 'needs-finish' || saved === 'ungraded' || saved === 'graded' || saved === 'duplicates' || saved === 'no-price') setCollectionFilter(saved);
    }).catch(() => undefined);
    getSavedSetting(SORT_OPTION_KEY, LEGACY_SORT_OPTION_KEY).then((saved) => {
      if (saved === 'recent' || saved === 'highest-value' || saved === 'name' || saved === 'set' || saved === 'quantity') setSortOption(saved);
    }).catch(() => undefined);
  }, []);

  function updateGridColumns(columns: 1 | 2 | 3 | 4 | 5) {
    setGridColumns(columns);
    AsyncStorage.setItem(GRID_COLUMNS_KEY, String(columns)).catch(() => undefined);
  }

  function updateCollectionFilter(filter: CollectionFilter) {
    setCollectionFilter(filter);
    AsyncStorage.setItem(FINISH_FILTER_KEY, filter).catch(() => undefined);
  }

  function updateSortOption(sort: SortOption) {
    setSortOption(sort);
    AsyncStorage.setItem(SORT_OPTION_KEY, sort).catch(() => undefined);
  }

  function beginScan() {
    setPhoto(null);
    setCandidate(null);
    setExtraction(null);
    setScreen('camera');
  }

  function acceptCard() {
    if (!candidate) return;
    addCard(candidate);
    setAddedName(candidate.name);
    setPhoto(null);
    setCandidate(null);
    setScreen('collection');
  }

  async function saveServerUrl(url: string) {
    const clean = normalizeServerUrl(url);
    setServerUrl(clean);
    await AsyncStorage.setItem(SERVER_URL_KEY, clean);
    return clean;
  }

  async function requestPricing(cardId: string): Promise<CardPricingResponse | null> {
    if (!serverUrl) return null;
    const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/cards/pricing?cardId=${encodeURIComponent(cardId)}`);
    const result = await response.json() as CardPricingResponse | { error?: string };
    if (!response.ok || !('success' in result)) return null;
    return result;
  }

  async function loadPricing(card: CollectionCard) {
    setPricing(null);
    setPricingError(null);
    if (!serverUrl) {
      setPricingError('Set up the scanner to view current prices.');
      return;
    }
    setPricingLoading(true);
    try {
      const result = await requestPricing(card.id);
      if (!result) {
        setPricingError('Pricing could not be loaded for this card.');
        return;
      }
      setPricing(result);
      setCollectionPricing((existing) => ({ ...existing, [card.id]: result }));
    } catch {
      setPricingError('Prices could not be loaded right now. Make sure TCG Binder Companion is open on your Mac.');
    } finally {
      setPricingLoading(false);
    }
  }

  async function requestGradedPricing(card: CollectionCard): Promise<GradedPricingResponse | null> {
    if (!serverUrl) return null;
    const params = new URLSearchParams({ name: card.name, number: card.cardNumber, set: card.setName });
    const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/cards/graded-pricing?${params.toString()}`);
    const result = await response.json() as GradedPricingResponse | { error?: string };
    if (!response.ok || !('success' in result)) return null;
    return result;
  }

  async function loadGradedPricing(card: CollectionCard) {
    setGradedPricing(null);
    setGradedPricingError(null);
    if (!serverUrl) {
      setGradedPricingError('Set up the scanner to view graded prices.');
      return;
    }
    setGradedPricingLoading(true);
    try {
      const result = await requestGradedPricing(card);
      if (!result) {
        setGradedPricingError('Graded pricing could not be loaded for this card.');
        return;
      }
      setGradedPricing(result);
      setGradedCollectionPricing((existing) => ({ ...existing, [card.id]: result }));
    } catch {
      setGradedPricingError('Graded prices could not be loaded right now. Make sure TCG Binder Companion is open on your Mac.');
    } finally {
      setGradedPricingLoading(false);
    }
  }

  const collectionIdsKey = collection.map((card) => card.id).sort().join('|');
  useEffect(() => {
    if (!serverUrl || collection.length === 0) {
      setCollectionPricing({});
      return;
    }
    let active = true;
    setCollectionPricingLoading(true);
    Promise.all(collection.map(async (card) => ({ id: card.id, pricing: await requestPricing(card.id).catch(() => null) })))
      .then((results) => {
        if (!active) return;
        const next: Record<string, CardPricingResponse> = {};
        results.forEach(({ id, pricing: result }) => { if (result) next[id] = result; });
        setCollectionPricing(next);
      })
      .finally(() => { if (active) setCollectionPricingLoading(false); });
    return () => { active = false; };
  }, [serverUrl, collectionIdsKey]);

  const gradedIdsKey = collection.filter((card) => Boolean(card.ownedGradeKey)).map((card) => card.id).sort().join('|');
  useEffect(() => {
    const gradedCards = collection.filter((card) => Boolean(card.ownedGradeKey));
    if (!serverUrl || gradedCards.length === 0) {
      setGradedCollectionPricing({});
      return;
    }
    let active = true;
    Promise.all(gradedCards.map(async (card) => ({ id: card.id, pricing: await requestGradedPricing(card).catch(() => null) })))
      .then((results) => {
        if (!active) return;
        const next: Record<string, GradedPricingResponse> = {};
        results.forEach(({ id, pricing: result }) => { if (result) next[id] = result; });
        setGradedCollectionPricing(next);
      });
    return () => { active = false; };
  }, [serverUrl, gradedIdsKey]);

  function openDetails(card: CollectionCard) {
    setSelectedCard(card);
    setGradedPricing(null);
    setGradedPricingError(null);
    setScreen('details');
    void loadPricing(card);
  }

  async function testConnection(url: string): Promise<boolean> {
    const clean = normalizeServerUrl(url);
    if (!clean) {
      Alert.alert('Scanner setup needed', 'Enter the address shown by TCG Binder Companion on your Mac.');
      return false;
    }
    try {
      const response = await fetch(`${clean}/api/health?verifyOcr=true`);
      const result = await response.json() as { ready?: boolean; message?: string; provider?: string; ocrReady?: boolean };
      const isCorrectBackend = result.provider === 'TCG Binder Companion' && result.ocrReady === true;
      const ready = response.ok && result.ready === true && isCorrectBackend;
      const statusMessage = ready
        ? 'Your scanner is connected and ready to recognize cards.'
        : 'TCG Binder could not start scanning. Make sure TCG Binder Companion is open on your Mac and try again.';
      setServerReady(ready);
      setServerStatusMessage(statusMessage);
      if (ready) Alert.alert('Scanner ready', statusMessage);
      else Alert.alert('Scanner unavailable', statusMessage);
      return ready;
    } catch {
      setServerReady(false);
      setServerStatusMessage('TCG Binder cannot connect right now. Make sure TCG Binder Companion is open on your Mac and both devices are on the same Wi-Fi network.');
      Alert.alert('Cannot connect', 'Make sure TCG Binder Companion is open on your Mac and both devices are on the same Wi-Fi network.');
      return false;
    }
  }

  async function identifyWithOcr() {
    if (!photo) return;
    if (!serverUrl) {
      Alert.alert('Set up scanning first', 'Connect TCG Binder to your Mac before scanning a card.');
      setScreen('settings');
      return;
    }
    setScreen('identifying');
    try {
      const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/cards/ocr-identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: photo.base64, mimeType: 'image/jpeg' }),
      });
      const result = await response.json() as IdentifyResponse | { error?: string; extraction?: AiExtraction; code?: string };
      if (!response.ok || !('success' in result)) {
        const failed = result as { error?: string; code?: string };
        Alert.alert('Card not found', failed.error ?? 'Try another photo or search for the card yourself.', [
          { text: 'Retake Photo', onPress: () => setScreen('camera') },
          { text: 'Search for Card', onPress: () => setScreen('manualSearch') },
        ]);
        return;
      }
      setCandidate(result.candidate);
      setExtraction(result.extraction);
      setMatchQuality(result.matchQuality);
      setMatchSource('scan');
      setScreen('confirm');
    } catch {
      Alert.alert('Scan unavailable', 'TCG Binder cannot connect to the scanner right now. Make sure TCG Binder Companion is open on your Mac.');
      setScreen('review');
    }
  }

  async function manualSearch(cardName: string, cardNumber: string) {
    if (!photo) return;
    if (!serverUrl) {
      Alert.alert('Set up scanning first', 'Connect TCG Binder to your Mac before searching for a card.');
      setScreen('settings');
      return;
    }
    setScreen('identifying');
    try {
      const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/cards/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardName, cardNumber }),
      });
      const result = await response.json() as IdentifyResponse | { error?: string };
      if (!response.ok || !('success' in result)) {
        const failed = result as { error?: string };
        Alert.alert('No match found', 'Try checking the spelling or entering the card number shown on your card.');
        setScreen('manualSearch');
        return;
      }
      setCandidate(result.candidate);
      setExtraction(result.extraction);
      setMatchQuality(result.matchQuality);
      setMatchSource('manual-search');
      setScreen('confirm');
    } catch {
      Alert.alert('Search unavailable', 'TCG Binder cannot connect right now. Make sure TCG Binder Companion is open on your Mac.');
      setScreen('manualSearch');
    }
  }

  const valuation = collection.reduce((summary, card) => {
    if (card.ownedGradeKey) {
      const row = gradedCollectionPricing[card.id]?.rows.find((price) => price.key === card.ownedGradeKey);
      if (!row) {
        summary.missingPriceCopies += card.quantity;
        return summary;
      }
      summary.valuedCopies += card.quantity;
      summary.marketValue += row.medianPrice * card.quantity;
      summary.gradedCopies += card.quantity;
      return summary;
    }
    const variant = collectionPricing[card.id]?.variants.find((row) => row.key === card.ownedFinishKey);
    if (!card.ownedFinishKey) {
      summary.unselectedCopies += card.quantity;
      return summary;
    }
    if (variant?.marketPrice === null || variant?.marketPrice === undefined) {
      summary.missingPriceCopies += card.quantity;
      return summary;
    }
    summary.valuedCopies += card.quantity;
    summary.marketValue += variant.marketPrice * card.quantity;
    summary.rawCopies += card.quantity;
    return summary;
  }, { marketValue: 0, valuedCopies: 0, rawCopies: 0, gradedCopies: 0, unselectedCopies: 0, missingPriceCopies: 0 });

  function chooseOwnedFinish(card: CollectionCard, variant: PriceVariant | null) {
    const updated = { ...card, ownedFinishKey: variant?.key, ownedFinishLabel: variant?.label };
    updateOwnedFinish(card.ownershipId, { key: variant?.key, label: variant?.label });
    setSelectedCard(updated);
  }


  function chooseOwnedGrade(card: CollectionCard, row: GradedPriceRow | null) {
    const updated = { ...card, ownedGradeKey: row?.key, ownedGradeLabel: row?.label, ownedGradeCompany: row?.company, ownedGrade: row?.grade };
    updateOwnedGrade(card.ownershipId, row ? { key: row.key, label: row.label, company: row.company, grade: row.grade } : null);
    setSelectedCard(updated);
  }

  function splitOwnedCopy(card: CollectionCard, variant: PriceVariant) {
    if (card.quantity < 2) return;
    splitOneCopy(card.ownershipId, { key: variant.key, label: variant.label });
    setSelectedCard({ ...card, quantity: card.quantity - 1 });
    Alert.alert('Copy separated', `One ${card.name} copy is now tracked as ${variant.label}. Your binder now tracks this version separately.`);
  }


  function splitForSeparateGrade(card: CollectionCard) {
    if (card.quantity < 2) return;
    splitOneForSeparateGrade(card.ownershipId);
    setSelectedCard({ ...card, quantity: card.quantity - 1 });
    Alert.alert('Copy separated', `One ${card.name} copy is ready to be assigned a different grade.`);
  }

  function stackValue(card: CollectionCard): number | null {
    if (card.ownedGradeKey) {
      const row = gradedCollectionPricing[card.id]?.rows.find((price) => price.key === card.ownedGradeKey);
      return row ? row.medianPrice * card.quantity : null;
    }
    const variant = collectionPricing[card.id]?.variants.find((row) => row.key === card.ownedFinishKey);
    return variant?.marketPrice == null ? null : variant.marketPrice * card.quantity;
  }

  const visibleCards = collection.filter((card) => {
    const match = `${card.name} ${card.setName} ${card.cardNumber} ${card.ownedFinishLabel ?? ''} ${card.ownedGradeLabel ?? ''}`.toLowerCase();
    const matchesSearch = match.includes(query.trim().toLowerCase());
    const isRaw = !card.ownedGradeKey;
    const hasPrice = stackValue(card) !== null;
    const matchesFilter = collectionFilter === 'all'
      || (collectionFilter === 'needs-finish' && isRaw && !card.ownedFinishKey)
      || (collectionFilter === 'ungraded' && isRaw)
      || (collectionFilter === 'graded' && !isRaw)
      || (collectionFilter === 'duplicates' && card.quantity > 1)
      || (collectionFilter === 'no-price' && !hasPrice);
    return matchesSearch && matchesFilter;
  }).sort((left, right) => {
    if (sortOption === 'highest-value') return (stackValue(right) ?? -1) - (stackValue(left) ?? -1);
    if (sortOption === 'name') return left.name.localeCompare(right.name);
    if (sortOption === 'set') return left.setName.localeCompare(right.setName) || left.cardNumber.localeCompare(right.cardNumber);
    if (sortOption === 'quantity') return right.quantity - left.quantity || left.name.localeCompare(right.name);
    return new Date(right.addedAt).getTime() - new Date(left.addedAt).getTime();
  });

  if (isLoading) return <Loading label="Opening your binder..." />;
  if (screen === 'settings') return (
    <Settings
      initialUrl={serverUrl}
      serverReady={serverReady}
      statusMessage={serverStatusMessage}
      onSave={async (url) => { await saveServerUrl(url); setScreen('collection'); }}
      onTest={async (url) => { const clean = await saveServerUrl(url); await testConnection(clean); }}
      onBack={() => setScreen('collection')}
    />
  );
  if (screen === 'details' && selectedCard) return (
    <CardDetails
      card={selectedCard}
      pricing={pricing}
      loading={pricingLoading}
      error={pricingError}
      gradedPricing={gradedPricing}
      gradedLoading={gradedPricingLoading}
      gradedError={gradedPricingError}
      onBack={() => setScreen('collection')}
      onLoadRaw={() => { void loadPricing(selectedCard); }}
      onLoadGraded={() => { void loadGradedPricing(selectedCard); }}
      onSelectFinish={(variant) => chooseOwnedFinish(selectedCard, variant)}
      onSelectGrade={(row) => chooseOwnedGrade(selectedCard, row)}
      onSplitOneCopy={(variant) => splitOwnedCopy(selectedCard, variant)}
      onSeparateGradeCopy={() => splitForSeparateGrade(selectedCard)}
      onRemove={() => Alert.alert('Remove card?', `Remove ${selectedCard.name} from your binder?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { removeCard(selectedCard.ownershipId); setSelectedCard(null); setScreen('collection'); } },
      ])}
    />
  );
  if (screen === 'manualSearch' && photo) return (
    <ManualSearch photoUri={photo.uri} onSearch={manualSearch} onBack={() => setScreen(candidate ? 'confirm' : 'review')} />
  );
  if (screen === 'camera' || screen === 'review') return (
    <CameraCapture
      reviewMode={screen === 'review'} photo={photo}
      onCaptured={(newPhoto) => { setPhoto(newPhoto); setScreen('review'); }}
      onOcrIdentify={identifyWithOcr}
      onRetake={() => { setPhoto(null); setScreen('camera'); }}
      onCancel={() => setScreen('collection')}
    />
  );
  if (screen === 'identifying' && photo) return <Identifying photoUri={photo.uri} />;
  if (screen === 'confirm' && photo && candidate && extraction) return (
    <Confirm
      photoUri={photo.uri}
      candidate={candidate}
      extraction={extraction}
      matchQuality={matchQuality}
      matchSource={matchSource}
      onBack={() => setScreen('camera')}
      onManualSearch={() => setScreen('manualSearch')}
      onAccept={acceptCard}
    />
  );
  return (
    <Collection
      collection={collection} visibleCards={visibleCards} totalCards={totalCards} query={query}
      addedName={addedName} serverReady={serverReady} hasServerUrl={Boolean(serverUrl)} onQuery={setQuery}
      marketValue={valuation.marketValue} valuedCopies={valuation.valuedCopies} rawCopies={valuation.rawCopies} gradedCopies={valuation.gradedCopies} unselectedCopies={valuation.unselectedCopies} missingPriceCopies={valuation.missingPriceCopies} collectionPricingLoading={collectionPricingLoading}
      gridColumns={gridColumns} onGridColumns={updateGridColumns}
      collectionFilter={collectionFilter} onCollectionFilter={updateCollectionFilter} sortOption={sortOption} onSortOption={updateSortOption}
      onScan={beginScan} onSettings={() => setScreen('settings')}
      onOpen={openDetails}
      onClear={() => Alert.alert('Clear collection?', 'This removes every saved card from your binder.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: clearCollection },
      ])}
    />
  );
}

function normalizeServerUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function Loading({ label }: { label: string }) {
  return <SafeAreaView style={styles.page}><View style={styles.center}><ActivityIndicator size="large" color="#D63C37" /><Text style={styles.muted}>{label}</Text></View></SafeAreaView>;
}

function Collection({ collection, visibleCards, totalCards, query, addedName, serverReady, hasServerUrl, marketValue, valuedCopies, rawCopies, gradedCopies, unselectedCopies, missingPriceCopies, collectionPricingLoading, gridColumns, onGridColumns, collectionFilter, onCollectionFilter, sortOption, onSortOption, onQuery, onScan, onSettings, onOpen, onClear }: {
  collection: CollectionCard[]; visibleCards: CollectionCard[]; totalCards: number; query: string; addedName: string | null;
  serverReady: boolean | null; hasServerUrl: boolean; marketValue: number; valuedCopies: number; rawCopies: number; gradedCopies: number; unselectedCopies: number; missingPriceCopies: number; collectionPricingLoading: boolean;
  gridColumns: 1 | 2 | 3 | 4 | 5; onGridColumns: (columns: 1 | 2 | 3 | 4 | 5) => void;
  collectionFilter: CollectionFilter; onCollectionFilter: (filter: CollectionFilter) => void; sortOption: SortOption; onSortOption: (sort: SortOption) => void;
  onQuery: (value: string) => void; onScan: () => void;
  onSettings: () => void; onOpen: (card: CollectionCard) => void; onClear: () => void;
}) {
  const { width } = useWindowDimensions();
  const [showControls, setShowControls] = useState(false);
  const statusLabel = serverReady ? 'Ready' : hasServerUrl ? 'Reconnect' : 'Connect';
  const gap = gridColumns >= 4 ? 7 : 12;
  const usableWidth = width - 40;
  const tileWidth = (usableWidth - gap * (gridColumns - 1)) / gridColumns;
  const compact = gridColumns >= 3;
  const uniqueCardCount = new Set(collection.map((card) => card.id)).size;
  const filterLabels: Record<CollectionFilter, string> = { all: 'All', 'needs-finish': 'Needs finish', ungraded: 'Ungraded', graded: 'Graded', duplicates: 'Duplicates', 'no-price': 'No price' };
  const sortLabels: Record<SortOption, string> = { recent: 'Recent', 'highest-value': 'Highest value', name: 'Name', set: 'Set', quantity: 'Quantity' };
  const hasCustomView = collectionFilter !== 'all' || sortOption !== 'recent' || gridColumns !== 2;

  return <SafeAreaView style={styles.page}><View style={styles.collectionPage}>
    <View style={styles.topRow}>
      <View style={styles.brandRow}><View style={styles.cardMark}><View style={styles.cardBack} /><View style={styles.cardFront} /></View><View><Text style={styles.eyebrow}>DIGITAL CARD BINDER</Text><Text style={styles.brand}>TCG Binder</Text></View></View>
      <Pressable onPress={onSettings} style={styles.serverChip}><View style={[styles.statusDot, serverReady && styles.statusReady]} /><Text style={styles.serverChipText}>{statusLabel}</Text></Pressable>
    </View>
    <View style={styles.stats}><Stat count={totalCards} label="Cards owned" /><Stat count={uniqueCardCount} label="Unique cards" /></View>
    {collection.length > 0 && <View style={styles.valuePanel}>
      <View style={styles.valueHeader}><Text style={styles.valueLabel}>ESTIMATED COLLECTION VALUE</Text><View style={styles.valueCoin}><Ionicons name="stats-chart" size={15} color="#102A43" /></View></View>
      <Text style={styles.valueAmount}>{collectionPricingLoading && valuedCopies === 0 ? 'Loading…' : valuedCopies === 0 ? 'Choose card types' : formatUsd(marketValue)}</Text>
      <Text style={styles.valueCaption}>{valuedCopies} valued · {rawCopies} ungraded · {gradedCopies} graded{unselectedCopies > 0 ? ` · ${unselectedCopies} finish needed` : ''}{missingPriceCopies > 0 ? ` · ${missingPriceCopies} missing price` : ''}</Text>
    </View>}
    {addedName && <View style={styles.banner}><Text style={styles.bannerText}>✓ {addedName} added to your collection</Text></View>}
    <View style={styles.searchToolsRow}>
      <TextInput value={query} onChangeText={onQuery} placeholder="Search your binder" placeholderTextColor="#817A70" style={styles.searchCompact} />
      {collection.length > 0 && <Pressable onPress={() => setShowControls((open) => !open)} style={[styles.controlToggle, (showControls || hasCustomView) && styles.controlToggleActive]}>
        <Text style={[styles.controlToggleText, (showControls || hasCustomView) && styles.controlToggleTextActive]}>View  ▾</Text>
      </Pressable>}
    </View>
    {collection.length > 0 && hasCustomView && !showControls && <View style={styles.activeViewPill}>
      <Text style={styles.activeViewText}>{filterLabels[collectionFilter]} · {sortLabels[sortOption]} · {gridColumns} per row</Text>
      <Pressable onPress={() => { onCollectionFilter('all'); onSortOption('recent'); onGridColumns(2); }}><Text style={styles.activeViewReset}>Reset</Text></Pressable>
    </View>}
    {collection.length > 0 && showControls && <View style={styles.controlsDrawer}>
      <View style={styles.drawerHeader}><Text style={styles.drawerTitle}>Organize Binder</Text><Pressable onPress={() => setShowControls(false)}><Text style={styles.drawerDone}>Done</Text></Pressable></View>
      <Text style={styles.drawerLabel}>SHOW</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollButtonRow}>
        {([['all', 'All'], ['needs-finish', 'Needs Finish'], ['ungraded', 'Ungraded'], ['graded', 'Graded'], ['duplicates', 'Duplicates'], ['no-price', 'Missing Price']] as const).map(([filter, label]) => <Pressable key={filter} onPress={() => onCollectionFilter(filter)} style={[styles.filterButton, collectionFilter === filter && styles.filterButtonActive]}><Text style={[styles.filterButtonText, collectionFilter === filter && styles.filterButtonTextActive]}>{label}</Text></Pressable>)}
      </ScrollView>
      <Text style={styles.drawerLabel}>SORT BY</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollButtonRow}>
        {([['recent', 'Recent'], ['highest-value', 'Highest Value'], ['name', 'Name'], ['set', 'Set'], ['quantity', 'Quantity']] as const).map(([sort, label]) => <Pressable key={sort} onPress={() => onSortOption(sort)} style={[styles.filterButton, sortOption === sort && styles.filterButtonActive]}><Text style={[styles.filterButtonText, sortOption === sort && styles.filterButtonTextActive]}>{label}</Text></Pressable>)}
      </ScrollView>
      <View style={styles.drawerBottomRow}>
        <View><Text style={styles.drawerLabel}>CARDS PER ROW</Text><View style={styles.layoutButtons}>{([1, 2, 3, 4, 5] as const).map((columns) => <Pressable key={columns} onPress={() => onGridColumns(columns)} style={[styles.layoutButton, gridColumns === columns && styles.layoutButtonActive]}><Text style={[styles.layoutButtonText, gridColumns === columns && styles.layoutButtonTextActive]}>{columns}</Text></Pressable>)}</View></View>
        <Pressable onPress={onClear} style={styles.drawerClear}><Text style={styles.drawerClearText}>Clear Collection</Text></Pressable>
      </View>
    </View>}
    {collection.length === 0 ? <View style={styles.center}><Text style={styles.emptyEmoji}>🃏</Text><Text style={styles.emptyTitle}>Your binder is empty</Text><Text style={styles.emptyBody}>Add your first card to begin building your collection.</Text></View> :
      visibleCards.length === 0 ? <View style={styles.center}><Text style={styles.emptyTitle}>No cards match this view</Text><Text style={styles.emptyBody}>Try another filter or search term.</Text></View> :
      <FlatList key={`grid-${gridColumns}`} data={visibleCards} keyExtractor={(item) => item.ownershipId} numColumns={gridColumns} columnWrapperStyle={gridColumns > 1 ? { gap } : undefined} contentContainerStyle={styles.grid} renderItem={({ item }) => <CardTile card={item} width={tileWidth} compact={compact} onPress={() => onOpen(item)} />} />}
    <Pressable onPress={onScan} style={styles.scanButton}><Text style={styles.scanButtonText}>●  Scan Card</Text></Pressable>
  </View></SafeAreaView>;
}

function Stat({ count, label }: { count: number; label: string }) {
  return <View style={styles.stat}><Text style={styles.statNumber}>{count}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function CardDetails({ card, pricing, loading, error, gradedPricing, gradedLoading, gradedError, onBack, onLoadRaw, onLoadGraded, onSelectFinish, onSelectGrade, onSplitOneCopy, onSeparateGradeCopy, onRemove }: {
  card: CollectionCard;
  pricing: CardPricingResponse | null;
  loading: boolean;
  error: string | null;
  gradedPricing: GradedPricingResponse | null;
  gradedLoading: boolean;
  gradedError: string | null;
  onBack: () => void;
  onLoadRaw: () => void;
  onLoadGraded: () => void;
  onSelectFinish: (variant: PriceVariant | null) => void;
  onSelectGrade: (row: GradedPriceRow | null) => void;
  onSplitOneCopy: (variant: PriceVariant) => void;
  onSeparateGradeCopy: () => void;
  onRemove: () => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailPricingTab>(card.ownedGradeKey ? 'graded' : 'ungraded');
  const [showManageCopies, setShowManageCopies] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const ownedVariant = pricing?.variants.find((variant) => variant.key === card.ownedFinishKey) ?? null;
  const ownedGradeRow = gradedPricing?.rows.find((row) => row.key === card.ownedGradeKey) ?? null;
  const ownedUnitValue = card.ownedGradeKey ? (ownedGradeRow?.medianPrice ?? null) : (ownedVariant?.marketPrice ?? null);
  const ownedTotalValue = ownedUnitValue === null ? null : ownedUnitValue * card.quantity;
  const ownedSummary = card.ownedGradeLabel
    ? card.ownedGradeLabel
    : card.ownedFinishLabel || 'Not configured';

  useEffect(() => {
    if (activeTab === 'graded' && !gradedPricing && !gradedLoading) onLoadGraded();
  }, [activeTab, gradedPricing, gradedLoading]);

  function showUngraded() { setActiveTab('ungraded'); if (!pricing && !loading) onLoadRaw(); }
  function showGraded() { setActiveTab('graded'); if (!gradedPricing && !gradedLoading) onLoadGraded(); }
  function chooseRawFinish(variant: PriceVariant) { if (card.ownedGradeKey) onSelectGrade(null); onSelectFinish(variant); }

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.detailsClean}>
    <SubHeader title="Card Details" onBack={onBack} />
    <View style={styles.detailHero}>
      <Image source={{ uri: card.imageUrl }} resizeMode="contain" style={styles.detailImageClean} />
      <View style={styles.detailHeroInfo}>
        <Text style={styles.detailTitleClean}>{card.name}</Text>
        <Text style={styles.detailMetaClean}>{card.setName}</Text>
        <Text style={styles.detailMetaClean}>{card.cardNumber} · {card.rarity}</Text>
        {card.quantity > 1 && <View style={styles.quantityTag}><Text style={styles.quantityTagText}>×{card.quantity} owned</Text></View>}
      </View>
    </View>

    <View style={styles.currentCardPanel}>
      <View><Text style={styles.drawerLabel}>CURRENTLY TRACKED AS</Text><Text style={styles.currentCardType}>{ownedSummary}</Text></View>
      {ownedTotalValue !== null && <Text style={styles.currentCardValue}>{formatUsd(ownedTotalValue)}</Text>}
    </View>

    <View style={styles.cleanTabs}>
      <Pressable onPress={showUngraded} style={[styles.cleanTab, activeTab === 'ungraded' && styles.cleanTabRawActive]}><Text style={[styles.cleanTabText, activeTab === 'ungraded' && styles.cleanTabRawText]}>Ungraded</Text></Pressable>
      <Pressable onPress={showGraded} style={[styles.cleanTab, activeTab === 'graded' && styles.cleanTabGradedActive]}><Text style={[styles.cleanTabText, activeTab === 'graded' && styles.cleanTabGradedText]}>Graded</Text></Pressable>
    </View>

    {activeTab === 'ungraded' && <View style={styles.cleanSection}>
      <View style={styles.cleanSectionHeader}><View><Text style={styles.sectionLabel}>UNGRADED VALUE</Text><Text style={styles.priceProvider}>Current prices · USD</Text></View><Pressable onPress={onLoadRaw} disabled={loading}><Text style={styles.textAction}>{loading ? 'Loading…' : 'Refresh'}</Text></Pressable></View>
      {loading && <View style={styles.priceLoading}><ActivityIndicator color="#D63C37" /><Text style={styles.muted}>Loading ungraded prices...</Text></View>}
      {error && !loading && <View style={styles.priceError}><Text style={styles.priceErrorText}>{error}</Text></View>}
      {pricing && !loading && !pricing.dataAvailable && <View style={styles.priceNotice}><Text style={styles.priceNoticeTitle}>No ungraded price data available</Text><Text style={styles.priceNoticeText}>Current prices are not available for this card right now.</Text></View>}
      {pricing && !loading && pricing.dataAvailable && <>
        <Text style={styles.selectionLabel}>SELECT YOUR FINISH</Text>
        <Text style={styles.priceRowsHint}>Market value shown on the right · lowest listing shown below each finish</Text>
        {pricing.variants.map((variant) => <Pressable key={variant.key} onPress={() => chooseRawFinish(variant)} style={[styles.cleanChoiceRow, !card.ownedGradeKey && card.ownedFinishKey === variant.key && styles.cleanChoiceSelected]}>
          <View><Text style={[styles.cleanChoiceTitle, !card.ownedGradeKey && card.ownedFinishKey === variant.key && styles.cleanChoiceSelectedText]}>{variant.label}</Text><Text style={styles.cleanChoiceSub}>Lowest listing {formatUsd(variant.lowPrice)}</Text></View>
          <Text style={[styles.cleanChoiceValue, !card.ownedGradeKey && card.ownedFinishKey === variant.key && styles.cleanChoiceSelectedText]}>{formatUsd(variant.marketPrice)}</Text>
        </Pressable>)}
      </>}
    </View>}

    {activeTab === 'graded' && <View style={styles.cleanSection}>
      <View style={styles.cleanSectionHeader}><View><Text style={styles.sectionLabel}>GRADED VALUE</Text><Text style={styles.priceProvider}>Recent graded sales · USD</Text></View><Pressable onPress={onLoadGraded} disabled={gradedLoading}><Text style={styles.textAction}>{gradedLoading ? 'Loading…' : 'Refresh'}</Text></Pressable></View>
      {gradedLoading && <View style={styles.priceLoading}><ActivityIndicator color="#105F58" /><Text style={styles.muted}>Loading graded values...</Text></View>}
      {gradedError && !gradedLoading && <View style={styles.priceError}><Text style={styles.priceErrorText}>{gradedError}</Text></View>}
      {gradedPricing && !gradedLoading && !gradedPricing.configured && <View style={styles.gradeSetup}><Text style={styles.gradeSetupTitle}>Graded prices unavailable</Text><Text style={styles.priceNoticeText}>Graded prices are not available right now.</Text></View>}
      {gradedPricing && !gradedLoading && gradedPricing.configured && !gradedPricing.dataAvailable && <View style={styles.priceNotice}><Text style={styles.priceNoticeTitle}>No graded prices found</Text><Text style={styles.priceNoticeText}>{gradedPricing.notice}</Text></View>}
      {gradedPricing && !gradedLoading && gradedPricing.dataAvailable && gradedPricing.rows.map((row) => <Pressable key={row.key} onPress={() => onSelectGrade(row)} style={[styles.cleanChoiceRow, card.ownedGradeKey === row.key && styles.cleanGradeSelected]}>
        <View><Text style={[styles.cleanChoiceTitle, card.ownedGradeKey === row.key && styles.cleanGradeSelectedText]}>{row.label}</Text><Text style={styles.cleanChoiceSub}>{row.sampleSize ? `${row.sampleSize} recent sale${row.sampleSize === 1 ? '' : 's'}` : 'Price history unavailable'}</Text></View>
        <Text style={[styles.cleanChoiceValue, card.ownedGradeKey === row.key && styles.cleanGradeSelectedText]}>{formatUsd(row.medianPrice)}</Text>
      </Pressable>)}
    </View>}

    {card.quantity > 1 && <View style={styles.managePanel}>
      <Pressable onPress={() => setShowManageCopies((open) => !open)} style={styles.manageToggle}><Text style={styles.manageToggleText}>{showManageCopies ? 'Hide copy management' : 'Manage duplicate copies'}</Text><Text style={styles.manageChevron}>{showManageCopies ? '−' : '+'}</Text></Pressable>
      {showManageCopies && activeTab === 'ungraded' && pricing?.dataAvailable && <>
        <Text style={styles.manageHelp}>Split one copy when it has a different finish.</Text>
        <Text style={styles.drawerLabel}>DIFFERENT FINISH</Text>
        <View style={styles.splitButtons}>{pricing.variants.filter((variant) => variant.key !== card.ownedFinishKey).map((variant) => <Pressable key={`split-${variant.key}`} onPress={() => onSplitOneCopy(variant)} style={styles.splitButton}><Text style={styles.splitButtonText}>Split 1 as {variant.label}</Text></Pressable>)}</View>
      </>}
      {showManageCopies && activeTab === 'graded' && <><Text style={styles.manageHelp}>Separate one copy before assigning its grade.</Text><Pressable onPress={onSeparateGradeCopy} style={styles.splitButton}><Text style={styles.splitButtonText}>Separate 1 Copy for Grade</Text></Pressable></>}
    </View>}

    <Pressable onPress={() => setShowRemove((shown) => !shown)} style={styles.moreActions}><Text style={styles.moreActionsText}>{showRemove ? 'Hide actions' : 'More actions'}</Text></Pressable>
    {showRemove && <View style={styles.detailActions}><PrimaryButton label="Remove From Collection" onPress={onRemove} secondary /></View>}
  </ScrollView></SafeAreaView>;
}

function formatUsd(value: number | null) {
  return value === null ? 'N/A' : `US$${value.toFixed(2)}`;
}

function formatPriceDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function Settings({ initialUrl, serverReady, statusMessage, onSave, onTest, onBack }: {
  initialUrl: string; serverReady: boolean | null; statusMessage: string; onSave: (url: string) => void; onTest: (url: string) => void; onBack: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [testing, setTesting] = useState(false);
  async function runTest() {
    setTesting(true);
    try { await onTest(url); } finally { setTesting(false); }
  }
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.settings}>
    <SubHeader title="Scanner Setup" onBack={onBack} />
    <Text style={styles.settingsTitle}>Connect TCG Binder</Text>
    <Text style={styles.settingsBody}>To recognize cards and load prices, connect to TCG Binder Companion running on your Mac.</Text>
    <Text style={styles.inputLabel}>COMPANION ADDRESS</Text>
    <TextInput
      value={url}
      onChangeText={setUrl}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      placeholder="http://192.168.1.25:8787"
      placeholderTextColor="#817A70"
      style={styles.urlInput}
    />
    <View style={styles.example}><Text style={styles.exampleTitle}>Example</Text><Text style={styles.exampleBody}>http://192.168.1.25:8787</Text><Text style={styles.exampleHelp}>Enter the address shown by TCG Binder Companion on your Mac.</Text></View>
    {serverReady !== null && <View style={[styles.health, serverReady ? styles.healthReady : styles.healthBad]}><Text style={styles.healthHeading}>{serverReady ? '✓ Connected' : 'Connection Problem'}</Text><Text style={styles.healthText}>{statusMessage || (serverReady ? 'TCG Binder is ready to scan cards.' : 'TCG Binder could not connect.')}</Text></View>}
    <View style={styles.actions}><PrimaryButton label={testing ? "Checking Connection..." : "Test Connection"} onPress={runTest} disabled={testing} /><PrimaryButton label="Save and Return" onPress={() => onSave(url)} secondary /></View>
  </ScrollView></SafeAreaView>;
}

function CameraCapture({ reviewMode, photo, onCaptured, onOcrIdentify, onRetake, onCancel }: {
  reviewMode: boolean; photo: CapturedPhoto | null; onCaptured: (photo: CapturedPhoto) => void;
  onOcrIdentify: () => void; onRetake: () => void; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function acceptImageResult(result: ImagePicker.ImagePickerResult, source: 'system-camera' | 'photo-library') {
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.uri || !asset.base64) {
      Alert.alert('Photo unavailable', 'The captured image could not be loaded. Please try again.');
      return;
    }
    console.log(`[camera] ${source} returned ${asset.width}x${asset.height} image at maximum quality.`);
    onCaptured({ uri: asset.uri, base64: asset.base64, width: asset.width, height: asset.height });
  }

  async function takeWithSystemCamera() {
    if (busy) return;
    try {
      setBusy(true);
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera access required', 'Allow camera access so TCG Binder can open the iPhone camera interface.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        cameraType: ImagePicker.CameraType.back,
        allowsEditing: false,
        quality: 1,
        base64: true,
        exif: false,
      });
      await acceptImageResult(result, 'system-camera');
    } catch {
      Alert.alert('Camera failed', 'The iPhone camera could not be opened. Use Import from Photos after taking a photo in the Camera app.');
    } finally {
      setBusy(false);
    }
  }

  async function importSharpPhoto() {
    if (busy) return;
    try {
      setBusy(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        base64: true,
        exif: false,
      });
      await acceptImageResult(result, 'photo-library');
    } catch {
      Alert.alert('Photo import failed', 'The selected image could not be imported. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (reviewMode && photo) return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.review}>
    <SubHeader title="Review Photo" onBack={onCancel} />
    <Text style={styles.reviewIntro}>Make sure the card name and number are clear before continuing.</Text>
    <View style={styles.photoFrame}><Image source={{ uri: photo.uri }} resizeMode="contain" style={styles.photo} /></View>
    <View style={styles.actions}><PrimaryButton label="Identify Card" onPress={onOcrIdentify} /><PrimaryButton label="Choose Another Photo" onPress={onRetake} secondary /></View>
  </ScrollView></SafeAreaView>;

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.nativeCapturePage}>
    <SubHeader title="Scan Card" onBack={onCancel} />
    <View style={styles.nativeCameraIcon}><Text style={styles.nativeCameraEmoji}>📷</Text></View>
    <Text style={styles.nativeCaptureTitle}>Add a Card</Text>
    <Text style={styles.nativeCaptureBody}>Take a clear photo or choose one from your library. Make sure the card name and number can be read.</Text>
    <View style={styles.nativeTip}><Text style={styles.noticeTitle}>PHOTO TIP</Text><Text style={styles.noticeBody}>For best results, use good lighting and tap the card number to focus before taking the photo.</Text></View>
    <View style={styles.actions}>
      <PrimaryButton label={busy ? 'Opening Camera...' : 'Take Photo'} onPress={takeWithSystemCamera} disabled={busy} />
      <PrimaryButton label="Choose from Photos" onPress={importSharpPhoto} secondary disabled={busy} />
      <PrimaryButton label="Cancel" onPress={onCancel} secondary disabled={busy} />
    </View>
  </ScrollView></SafeAreaView>;
}

function ManualSearch({ photoUri, onSearch, onBack }: { photoUri: string; onSearch: (cardName: string, cardNumber: string) => void; onBack: () => void }) {
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.manual}>
    <SubHeader title="Choose Correct Card" onBack={onBack} />
    <Text style={styles.settingsTitle}>Find Your Card</Text>
    <Text style={styles.settingsBody}>Not the right match? Enter the card name and number shown on your card.</Text>
    <View style={styles.manualPhotoFrame}><Image source={{ uri: photoUri }} resizeMode="contain" style={styles.photo} /></View>
    <Text style={styles.inputLabel}>CARD NAME</Text>
    <TextInput value={cardName} onChangeText={setCardName} placeholder="Pikachu" placeholderTextColor="#817A70" style={styles.urlInput} />
    <Text style={styles.inputLabel}>CARD NUMBER (OPTIONAL)</Text>
    <TextInput value={cardNumber} onChangeText={setCardNumber} placeholder="GG30/GG70" placeholderTextColor="#817A70" style={styles.urlInput} />
    <View style={styles.actions}><PrimaryButton label="Search Cards" onPress={() => onSearch(cardName, cardNumber)} /><PrimaryButton label="Back to Match" onPress={onBack} secondary /></View>
  </ScrollView></SafeAreaView>;
}

function Identifying({ photoUri }: { photoUri: string }) {
  return <SafeAreaView style={styles.page}><View style={styles.identifying}>
    <View style={styles.identifyImageFrame}><Image source={{ uri: photoUri }} resizeMode="contain" style={styles.identifyImage} /></View>
    <ActivityIndicator style={styles.identifySpinner} size="large" color="#D63C37" />
    <Text style={styles.identifyTitle}>Finding your card...</Text>
    <Text style={styles.emptyBody}>Matching your photo to the right card.</Text>
  </View></SafeAreaView>;
}

function Confirm({ photoUri, candidate, extraction, matchQuality, matchSource, onBack, onManualSearch, onAccept }: {
  photoUri: string; candidate: CardCandidate; extraction: AiExtraction; matchQuality: 'exact-number' | 'name-only' | null; matchSource: 'scan' | 'manual-search';
  onBack: () => void; onManualSearch: () => void; onAccept: () => void;
}) {
  const exact = matchQuality === 'exact-number';
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.confirm}>
    <SubHeader title="Confirm Match" onBack={onBack} />
    <Text style={styles.confirmTitle}>Is this the right card?</Text>
    <View style={[styles.matchBadge, exact ? styles.exactBadge : styles.reviewBadge]}><Text style={[styles.matchBadgeText, exact ? styles.exactText : styles.reviewText]}>{exact ? '✓ Exact match found' : 'Please check the artwork'}</Text></View>
    <View style={styles.compare}><View style={styles.compareSide}><Text style={styles.compareLabel}>YOUR CARD</Text><Image source={{ uri: photoUri }} resizeMode="contain" style={styles.compareImage} /></View>
      <View style={styles.compareSide}><Text style={styles.compareLabel}>MATCH FOUND</Text><Image source={{ uri: candidate.imageUrl }} resizeMode="contain" style={styles.compareImage} /></View></View>
    <Text style={styles.cardTitle}>{candidate.name}</Text><Text style={styles.cardMeta}>{candidate.setName}</Text><Text style={styles.cardMeta}>{candidate.cardNumber} · {candidate.rarity}</Text>
    <View style={styles.actions}><PrimaryButton label="Add to Binder" onPress={onAccept} /><PrimaryButton label="Choose Different Card" onPress={onManualSearch} secondary /><PrimaryButton label="Try Another Photo" onPress={onBack} secondary /></View>
  </ScrollView></SafeAreaView>;
}

function SubHeader({ title, onBack, dark = false }: { title: string; onBack: () => void; dark?: boolean }) {
  return <View style={styles.subHeader}><Pressable onPress={onBack}><Text style={[styles.back, dark && styles.white]}>‹ Back</Text></Pressable><Text style={[styles.headerTitle, dark && styles.white]}>{title}</Text><View style={styles.headerSpace} /></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F0E7' }, darkPage: { flex: 1, backgroundColor: '#0F2237' },
  collectionPage: { flex: 1, paddingHorizontal: 20, paddingTop: 18 }, topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11 }, cardMark: { width: 43, height: 43, position: 'relative', alignItems: 'center', justifyContent: 'center' }, cardBack: { position: 'absolute', width: 24, height: 32, right: 3, top: 6, borderRadius: 8, backgroundColor: '#F2D28A', borderWidth: 2, borderColor: '#102A43', transform: [{ rotate: '8deg' }] }, cardFront: { width: 24, height: 32, borderRadius: 8, backgroundColor: '#D63C37', borderWidth: 2, borderColor: '#102A43', transform: [{ rotate: '-7deg' }] }, cardStripe: { position: 'absolute', top: 6, width: 12, height: 3, borderRadius: 2, backgroundColor: '#FFFDF8' }, cardDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFDF8', borderWidth: 2, borderColor: '#102A43' },
  eyebrow: { color: '#D63C37', fontWeight: '900', fontSize: 10, letterSpacing: 1.7 }, brand: { color: '#102A43', fontWeight: '900', fontSize: 30, marginTop: 2, letterSpacing: -0.5 },
  topActions: { alignItems: 'flex-end', gap: 8 }, serverChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, backgroundColor: '#F8E6E1' }, statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#AAA293' }, statusReady: { backgroundColor: '#17805F' }, serverChipText: { color: '#D63C37', fontWeight: '700', fontSize: 12 },
  clear: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 12, backgroundColor: '#F8E6E1' }, clearText: { color: '#D63C37', fontWeight: '700' },
  stats: { flexDirection: 'row', gap: 12, marginTop: 20 }, stat: { flex: 1, padding: 15, borderRadius: 18, backgroundColor: '#FFFDF8', borderColor: '#E5D8BF', borderWidth: 1, borderTopWidth: 3, borderTopColor: '#D39B37' }, statNumber: { color: '#102A43', fontWeight: '800', fontSize: 24 }, statLabel: { color: '#68717B', fontSize: 12 },
  valuePanel: { marginTop: 12, borderRadius: 20, backgroundColor: '#FFFDF8', padding: 17, borderWidth: 1, borderColor: '#E5D8BF', borderTopWidth: 3, borderTopColor: '#D39B37' }, valueHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, valueCoin: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F8E8D0', borderWidth: 1, borderColor: '#E6C27A', justifyContent: 'center', alignItems: 'center' }, valueCoinText: { color: '#D39B37', fontWeight: '900', fontSize: 12 }, valueLabel: { color: '#68717B', fontWeight: '800', fontSize: 10, letterSpacing: 1 }, valueAmount: { color: '#102A43', fontWeight: '800', fontSize: 27, marginTop: 7 }, valueNote: { color: '#68717B', fontSize: 11, lineHeight: 16, marginTop: 8 }, valueCaption: { color: '#68717B', fontSize: 12, marginTop: 8, lineHeight: 18 },
  banner: { marginTop: 14, borderRadius: 14, backgroundColor: '#E3F3EA', padding: 13 }, bannerText: { color: '#136B50', fontWeight: '600', fontSize: 13 },
  search: { marginTop: 15, height: 50, backgroundColor: '#FFFDF8', borderColor: '#E5D8BF', borderWidth: 1, borderRadius: 15, paddingHorizontal: 16, color: '#102A43' },
  scrollButtonRow: { gap: 7, paddingRight: 8 },
  finishFilterPanel: { marginTop: 12, gap: 8 }, filterButtons: { flexDirection: 'row', gap: 7 }, filterButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 11, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#E5D8BF' }, filterButtonActive: { backgroundColor: '#D63C37', borderColor: '#D63C37' }, filterButtonText: { color: '#68717B', fontSize: 11, fontWeight: '700' }, filterButtonTextActive: { color: '#FFFFFF' },
  layoutPanel: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, layoutLabel: { color: '#68717B', fontWeight: '800', fontSize: 10, letterSpacing: 1 }, layoutButtons: { flexDirection: 'row', gap: 6 }, layoutButton: { height: 32, minWidth: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#E5D8BF' }, layoutButtonActive: { backgroundColor: '#D63C37', borderColor: '#D63C37' }, layoutButtonText: { color: '#68717B', fontWeight: '800', fontSize: 13 }, layoutButtonTextActive: { color: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 26 }, muted: { color: '#68717B', marginTop: 10, textAlign: 'center' }, emptyEmoji: { fontSize: 43, marginBottom: 15 }, emptyTitle: { color: '#102A43', fontWeight: '800', fontSize: 21, textAlign: 'center' }, emptyBody: { color: '#68717B', lineHeight: 21, textAlign: 'center', marginTop: 8, marginBottom: 18 },
  gridRow: { gap: 15 }, grid: { paddingTop: 14, paddingBottom: 98 }, scanButton: { position: 'absolute', right: 20, bottom: 25, height: 58, borderRadius: 29, backgroundColor: '#D63C37', justifyContent: 'center', paddingHorizontal: 21, borderWidth: 2, borderColor: '#FFFDF8', shadowColor: '#102A43', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 }, scanButtonText: { color: '#FFFDF8', fontSize: 15, fontWeight: '700' },
  details: { padding: 20, paddingBottom: 35 }, splitPanel: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#E5D8BF', paddingTop: 14 }, splitTitle: { color: '#102A43', fontWeight: '800', fontSize: 11, letterSpacing: .8 }, splitHelp: { color: '#68717B', fontSize: 12, lineHeight: 18, marginTop: 7, marginBottom: 10 }, splitButtons: { gap: 8 }, splitButton: { borderRadius: 12, backgroundColor: '#F5F0E7', borderWidth: 1, borderColor: '#E5D8BF', paddingHorizontal: 12, paddingVertical: 10 }, splitButtonText: { color: '#D63C37', fontWeight: '700', fontSize: 12 }, detailImage: { height: 320, width: '100%', resizeMode: 'contain', marginTop: 24, borderRadius: 20, backgroundColor: '#EEE6D7' }, detailTitle: { color: '#102A43', fontWeight: '800', fontSize: 27, textAlign: 'center', marginTop: 18 }, detailMeta: { color: '#68717B', textAlign: 'center', marginTop: 6 }, ownedPanel: { marginTop: 24, borderRadius: 18, padding: 16, backgroundColor: '#FFFDF8', borderColor: '#E5D8BF', borderWidth: 1 }, ownedHelp: { color: '#68717B', lineHeight: 18, fontSize: 12, marginTop: 7, marginBottom: 12 }, finishChoices: { gap: 9 }, finishChoice: { borderWidth: 1, borderColor: '#E5D8BF', borderRadius: 13, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, finishChoiceSelected: { backgroundColor: '#F8E8D0', borderColor: '#D63C37' }, finishChoiceName: { color: '#102A43', fontWeight: '700' }, finishChoicePrice: { color: '#68717B', fontWeight: '600' }, finishChoiceNameSelected: { color: '#D63C37' }, clearFinish: { alignSelf: 'flex-start', paddingVertical: 8 }, clearFinishText: { color: '#95651D', fontWeight: '700', fontSize: 12 }, ownedPlaceholder: { color: '#68717B', fontSize: 12, marginTop: 10 }, ownedValueRow: { marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#E5D8BF', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, ownedValueLabel: { color: '#445263', fontWeight: '700' }, ownedValueAmount: { color: '#102A43', fontWeight: '800', fontSize: 20 }, priceHeader: { marginTop: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionLabel: { color: '#D63C37', fontWeight: '800', fontSize: 11, letterSpacing: 1.3 }, priceProvider: { color: '#68717B', marginTop: 5, fontSize: 12 }, refreshButton: { borderRadius: 12, backgroundColor: '#F8E8D0', paddingHorizontal: 13, paddingVertical: 10 }, refreshText: { color: '#D63C37', fontWeight: '700', fontSize: 12 }, priceLoading: { padding: 24, borderRadius: 16, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#E5D8BF', alignItems: 'center', marginTop: 16 }, priceError: { padding: 15, marginTop: 16, borderRadius: 15, backgroundColor: '#FFF2F0' }, priceErrorText: { color: '#A52F2B', lineHeight: 20 }, priceSummary: { flexDirection: 'row', gap: 12, marginTop: 16 }, priceSummaryBlock: { flex: 1, borderRadius: 16, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#E5D8BF', padding: 14 }, priceSummaryLabel: { color: '#68717B', fontSize: 10, fontWeight: '800', letterSpacing: .7 }, priceSummaryValue: { color: '#102A43', fontWeight: '800', fontSize: 22, marginTop: 8 }, variantRow: { marginTop: 11, borderRadius: 15, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#E5D8BF', padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, variantName: { color: '#102A43', fontWeight: '700', fontSize: 15 }, variantMetrics: { alignItems: 'flex-end', gap: 4 }, variantPrice: { color: '#102A43', fontWeight: '700' }, variantMarket: { color: '#68717B', fontSize: 12 }, updatedText: { color: '#68717B', fontSize: 12, marginTop: 12 }, priceNotice: { padding: 14, marginTop: 15, borderRadius: 15, backgroundColor: '#F8E8D0' }, priceNoticeTitle: { color: '#D63C37', fontWeight: '800', fontSize: 12, marginBottom: 6 }, priceNoticeText: { color: '#445263', lineHeight: 19, fontSize: 12 }, detailActions: { marginTop: 22 },
  conditionNote: { color: '#68717B', lineHeight: 18, fontSize: 12, marginBottom: 12 }, conditionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, conditionChoice: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E5D8BF', backgroundColor: '#FFFDF8' }, conditionChoiceSelected: { borderColor: '#116B63', backgroundColor: '#E2F0EA' }, conditionChoiceText: { color: '#445263', fontSize: 12, fontWeight: '700' }, conditionChoiceTextSelected: { color: '#105F58' },
  ownershipTabs: { flexDirection: 'row', gap: 8, marginBottom: 15 }, ownershipTab: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: '#F5F0E7', borderWidth: 1, borderColor: '#E5D8BF' }, ownershipTabActive: { backgroundColor: '#F8E8D0', borderColor: '#D63C37' }, gradedTabActive: { backgroundColor: '#E2F0EA', borderColor: '#116B63' }, ownershipTabText: { color: '#68717B', fontWeight: '700' }, ownershipTabTextActive: { color: '#D63C37' }, gradedTabTextActive: { color: '#105F58' }, miniLabel: { color: '#68717B', fontWeight: '800', fontSize: 10, letterSpacing: 1, marginBottom: 10 }, selectedGrade: { borderRadius: 14, borderColor: '#B6D9CC', borderWidth: 1, backgroundColor: '#E2F0EA', padding: 13 }, selectedGradeLabel: { fontSize: 10, letterSpacing: 1, fontWeight: '800', color: '#105F58' }, selectedGradeName: { marginTop: 7, color: '#0B544D', fontWeight: '800', fontSize: 17 }, selectedGradePrice: { marginTop: 4, color: '#105F58', fontWeight: '600' }, gradedRow: { marginTop: 11, borderRadius: 15, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#E5D8BF', padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, gradedRowSelected: { borderColor: '#116B63', backgroundColor: '#E2F0EA' }, gradedRowNameSelected: { color: '#105F58' }, gradePrice: { color: '#102A43', fontWeight: '800', fontSize: 18 }, gradeSetup: { padding: 14, marginTop: 15, borderRadius: 15, backgroundColor: '#E2F0EA' }, gradeSetupTitle: { color: '#105F58', fontWeight: '800', fontSize: 12, marginBottom: 6 },
  searchToolsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 15 }, searchCompact: { flex: 1, height: 50, backgroundColor: '#FFFDF8', borderColor: '#E5D8BF', borderWidth: 1, borderRadius: 15, paddingHorizontal: 16, color: '#102A43' }, controlToggle: { height: 50, paddingHorizontal: 13, borderRadius: 15, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#E5D8BF', alignItems: 'center', justifyContent: 'center' }, controlToggleActive: { borderColor: '#D63C37', backgroundColor: '#F8E8D0' }, controlToggleText: { color: '#5F6570', fontWeight: '700', fontSize: 12 }, controlToggleTextActive: { color: '#D63C37' },
  activeViewPill: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8E8D0', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 }, activeViewText: { color: '#445263', fontWeight: '600', fontSize: 12 }, activeViewReset: { color: '#D63C37', fontWeight: '800', fontSize: 12 },
  controlsDrawer: { marginTop: 12, borderRadius: 18, borderWidth: 1, borderColor: '#E5D8BF', backgroundColor: '#FFFDF8', padding: 14, gap: 10 }, drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }, drawerTitle: { color: '#102A43', fontWeight: '800', fontSize: 16 }, drawerDone: { color: '#D63C37', fontWeight: '800', fontSize: 13 }, drawerLabel: { color: '#68717B', fontWeight: '800', fontSize: 10, letterSpacing: 1, marginTop: 6, marginBottom: 7 }, drawerBottomRow: { marginTop: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }, drawerClear: { paddingHorizontal: 10, paddingVertical: 9 }, drawerClearText: { color: '#A03B35', fontWeight: '700', fontSize: 12 },
  detailsClean: { padding: 20, paddingBottom: 42 }, detailHero: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 16 }, detailImageClean: { width: 102, height: 143, resizeMode: 'contain', borderRadius: 14, backgroundColor: '#EEE6D7' }, detailHeroInfo: { flex: 1 }, detailTitleClean: { color: '#102A43', fontWeight: '800', fontSize: 24 }, detailMetaClean: { color: '#68717B', fontSize: 13, marginTop: 6 }, quantityTag: { alignSelf: 'flex-start', marginTop: 12, backgroundColor: '#F8E8D0', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 6 }, quantityTagText: { color: '#D63C37', fontWeight: '700', fontSize: 12 },
  currentCardPanel: { marginTop: 22, borderRadius: 17, padding: 15, backgroundColor: '#FFFDF8', borderColor: '#E5D8BF', borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, currentCardType: { color: '#102A43', fontWeight: '800', fontSize: 15, marginTop: 4 }, currentCardValue: { color: '#102A43', fontWeight: '800', fontSize: 18 }, cleanTabs: { flexDirection: 'row', backgroundColor: '#E8E0D3', padding: 4, borderRadius: 16, marginTop: 17, borderWidth: 1, borderColor: '#E5D8BF' }, cleanTab: { flex: 1, borderRadius: 11, alignItems: 'center', paddingVertical: 12 }, cleanTabRawActive: { backgroundColor: '#FFFDF8' }, cleanTabGradedActive: { backgroundColor: '#FFFDF8' }, cleanTabText: { color: '#68717B', fontWeight: '700' }, cleanTabRawText: { color: '#D63C37' }, cleanTabGradedText: { color: '#105F58' },
  cleanSection: { marginTop: 16, borderRadius: 18, padding: 15, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#E5D8BF' }, cleanSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, textAction: { color: '#D63C37', fontWeight: '700', fontSize: 13 }, priceSummaryCompact: { flexDirection: 'row', gap: 28, marginTop: 17, marginBottom: 14 }, priceSummaryValueCompact: { color: '#102A43', fontWeight: '800', fontSize: 20, marginTop: 5 }, selectionLabel: { color: '#68717B', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 16, marginBottom: 8 }, cleanChoiceRow: { minHeight: 54, borderRadius: 13, borderWidth: 1, borderColor: '#E5D8BF', paddingHorizontal: 13, paddingVertical: 11, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, cleanChoiceSelected: { borderColor: '#D39B37', backgroundColor: '#FAF0D7' }, cleanGradeSelected: { borderColor: '#116B63', backgroundColor: '#E2F0EA' }, cleanChoiceTitle: { color: '#102A43', fontWeight: '700', fontSize: 14 }, cleanChoiceValue: { color: '#102A43', fontWeight: '800', fontSize: 15 }, cleanChoiceSub: { color: '#68717B', fontSize: 11, marginTop: 4 }, cleanChoiceSelectedText: { color: '#8C5C13' }, cleanGradeSelectedText: { color: '#105F58' }, cleanNote: { color: '#68717B', fontSize: 11, lineHeight: 17, marginTop: 10 }, priceRowsHint: { color: '#68717B', fontSize: 11, lineHeight: 16, marginBottom: 10 },
  managePanel: { borderRadius: 17, borderWidth: 1, borderColor: '#E5D8BF', backgroundColor: '#FFFDF8', marginTop: 16, padding: 14 }, manageToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, manageToggleText: { color: '#102A43', fontWeight: '700', fontSize: 14 }, manageChevron: { color: '#D63C37', fontWeight: '800', fontSize: 19 }, manageHelp: { color: '#68717B', fontSize: 12, lineHeight: 18, marginTop: 12, marginBottom: 8 }, moreActions: { alignSelf: 'center', paddingVertical: 16, paddingHorizontal: 16, marginTop: 5 }, moreActionsText: { color: '#68717B', fontWeight: '700', fontSize: 13 },
  settings: { padding: 20, paddingBottom: 35 }, manual: { padding: 20, paddingBottom: 35 }, manualPhotoFrame: { height: 260, backgroundColor: '#12283E', borderRadius: 22, padding: 10, marginTop: 18 }, settingsTitle: { fontSize: 26, color: '#102A43', fontWeight: '800', marginTop: 32 }, settingsBody: { color: '#68717B', lineHeight: 21, marginTop: 9 }, inputLabel: { color: '#D63C37', fontWeight: '800', letterSpacing: 1.1, fontSize: 11, marginTop: 27, marginBottom: 8 }, urlInput: { height: 53, backgroundColor: '#FFFDF8', borderRadius: 15, borderWidth: 1, borderColor: '#DFD0B6', color: '#102A43', paddingHorizontal: 14 }, example: { padding: 15, backgroundColor: '#F8E8D0', borderRadius: 15, marginTop: 13 }, exampleTitle: { color: '#D63C37', fontSize: 11, fontWeight: '800', letterSpacing: 1 }, exampleBody: { color: '#102A43', fontWeight: '700', marginTop: 7 }, exampleHelp: { color: '#5F6570', marginTop: 7, lineHeight: 19, fontSize: 12 }, health: { padding: 14, borderRadius: 15, marginTop: 16 }, healthReady: { backgroundColor: '#E3F3EA' }, healthBad: { backgroundColor: '#FFF2F0' }, healthHeading: { color: '#102A43', fontWeight: '800', fontSize: 14, marginBottom: 6 }, healthText: { color: '#445263', fontWeight: '600', lineHeight: 19 },
  permission: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 12 }, cameraEmoji: { textAlign: 'center', fontSize: 54, marginBottom: 8 }, subHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, back: { color: '#D63C37', fontSize: 17, fontWeight: '700', width: 72 }, headerTitle: { color: '#102A43', fontSize: 20, fontWeight: '800' }, headerSpace: { width: 72 }, white: { color: '#FFFDF8' },
  cameraPage: { flex: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18 }, cameraHelp: { color: '#C9C1B1', textAlign: 'center', lineHeight: 20, marginVertical: 18 }, cameraFrame: { flex: 1, overflow: 'hidden', borderRadius: 27 }, camera: { flex: 1 }, overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' }, guide: { width: '70%', aspectRatio: 0.715, borderColor: '#FFFDF8', borderWidth: 2, borderStyle: 'dashed', borderRadius: 19 }, guideText: { marginTop: 20, color: '#FFFDF8', backgroundColor: 'rgba(0,0,0,0.42)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 15, fontWeight: '600', fontSize: 12 },
  resolutionLabel: { color: '#C9C1B1', textAlign: 'center', fontSize: 12, fontWeight: '600', paddingTop: 10 }, controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 14 }, control: { alignItems: 'center', width: 68 }, controlSymbol: { color: '#FFFDF8', fontSize: 27 }, controlLabel: { color: '#C9C1B1', fontSize: 12 }, shutter: { width: 76, height: 76, borderRadius: 38, borderColor: '#E4D6BB', borderWidth: 5, backgroundColor: '#FFFDF8', alignItems: 'center', justifyContent: 'center' }, shutterInner: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: '#D63C37' },
  nativeCapturePage: { padding: 20, paddingBottom: 34, flexGrow: 1 }, nativeCameraIcon: { height: 154, width: 154, borderRadius: 77, backgroundColor: '#F8E8D0', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: 46, marginBottom: 24 }, nativeCameraEmoji: { fontSize: 65 }, nativeCaptureTitle: { fontSize: 28, fontWeight: '800', textAlign: 'center', color: '#102A43', marginBottom: 12 }, nativeCaptureBody: { color: '#5F6570', lineHeight: 22, fontSize: 15, textAlign: 'center', marginBottom: 12 }, nativeTip: { marginTop: 20, borderRadius: 15, padding: 14, backgroundColor: '#F8E8D0' },
  review: { padding: 20, paddingBottom: 30 }, photoResolution: { color: '#68717B', textAlign: 'center', fontSize: 12, fontWeight: '600', marginTop: 9 }, reviewIntro: { color: '#68717B', textAlign: 'center', marginVertical: 17, lineHeight: 20 }, photoFrame: { height: 340, backgroundColor: '#12283E', borderRadius: 24, padding: 10 }, photo: { flex: 1, borderRadius: 17 }, notice: { marginTop: 17, borderRadius: 15, padding: 14, backgroundColor: '#F8E8D0' }, noticeTitle: { color: '#D63C37', fontSize: 11, letterSpacing: 1, fontWeight: '800' }, noticeBody: { color: '#445263', marginTop: 7, lineHeight: 19 },
  identifying: { flex: 1, justifyContent: 'center', padding: 30 }, identifyImageFrame: { height: 300, padding: 10, backgroundColor: '#12283E', borderRadius: 24 }, identifyImage: { flex: 1, borderRadius: 17 }, identifySpinner: { marginTop: 28 }, identifyTitle: { color: '#102A43', fontSize: 23, fontWeight: '800', textAlign: 'center', marginTop: 17 },
  actions: { gap: 10, marginTop: 20 }, confirm: { padding: 20, paddingBottom: 30 }, confirmTitle: { fontSize: 25, fontWeight: '800', textAlign: 'center', color: '#102A43', marginTop: 25 }, sourceText: { textAlign: 'center', color: '#D63C37', fontWeight: '700', fontSize: 12, marginTop: 7 }, matchBadge: { alignSelf: 'center', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, marginTop: 13 }, exactBadge: { backgroundColor: '#E3F3EA' }, reviewBadge: { backgroundColor: '#FFF1D7' }, matchBadgeText: { fontSize: 12, fontWeight: '700' }, exactText: { color: '#136B50' }, reviewText: { color: '#95651D' },
  compare: { flexDirection: 'row', gap: 12, marginTop: 23 }, compareSide: { flex: 1 }, compareLabel: { color: '#68717B', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 7 }, compareImage: { width: '100%', height: 242, borderRadius: 14, backgroundColor: '#EEE6D7' }, cardTitle: { textAlign: 'center', marginTop: 19, fontSize: 23, color: '#102A43', fontWeight: '800' }, cardMeta: { textAlign: 'center', color: '#68717B', marginTop: 5 }, extracted: { padding: 14, marginTop: 18, backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#E5D8BF', borderRadius: 15 }, extractedTitle: { color: '#D63C37', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 7 }, extractedLine: { color: '#445263', marginTop: 4 },
});
