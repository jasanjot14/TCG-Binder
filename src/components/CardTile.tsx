import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { CollectionCard } from '../types/card';

export function CardTile({ card, onPress, width, compact }: { card: CollectionCard; onPress: () => void; width: number; compact: boolean }) {
  const [failed, setFailed] = useState(false);
  const needsFinish = !card.ownedGradeLabel && !card.ownedFinishLabel;
  const ownershipLabel = card.ownedGradeLabel
    ?? (card.ownedFinishLabel || 'Needs finish');
  const needsSetup = needsFinish;
  return (
    <Pressable onPress={onPress} style={[styles.tile, { width }, compact && styles.compactTile]}>
      {failed ? (
        <View style={styles.fallback}><Text style={[styles.fallbackName, compact && styles.compactName]}>{card.name}</Text></View>
      ) : (
        <Image onError={() => setFailed(true)} source={{ uri: card.imageUrl }} style={styles.image} />
      )}
      {card.quantity > 1 && <View style={[styles.badge, compact && styles.compactBadge]}><Text style={styles.badgeText}>×{card.quantity}</Text></View>}
      <Text style={[styles.name, compact && styles.compactName]} numberOfLines={1}>{card.name}</Text>
      {!compact && <Text style={styles.number}>{card.cardNumber}</Text>}
      <Text style={[styles.status, card.ownedGradeLabel ? styles.graded : needsSetup ? styles.missing : styles.ready, compact && styles.compactStatus]} numberOfLines={1}>{ownershipLabel}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  tile: { backgroundColor: '#FFFDF8', borderRadius: 16, padding: 7, marginBottom: 15, borderWidth: 1, borderColor: '#D9C8A8', shadowColor: '#102A43', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  compactTile: { padding: 5, borderRadius: 11 },
  image: { width: '100%', aspectRatio: 0.72, borderRadius: 10, backgroundColor: '#EEE6D7', borderWidth: 1, borderColor: '#E5D8BF' },
  fallback: { width: '100%', aspectRatio: 0.72, borderRadius: 11, backgroundColor: '#102A43', justifyContent: 'center', padding: 7 },
  fallbackName: { color: '#FFFDF8', fontWeight: '700', textAlign: 'center' },
  badge: { position: 'absolute', top: 13, right: 13, backgroundColor: '#D63C37', borderRadius: 15, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: '#FFFDF8' },
  compactBadge: { top: 8, right: 8, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { color: '#FFFDF8', fontWeight: '800', fontSize: 11 },
  name: { marginTop: 8, color: '#102A43', fontSize: 13, fontWeight: '700' },
  compactName: { fontSize: 10, marginTop: 5 },
  number: { color: '#68717B', fontSize: 11, marginTop: 2 },
  status: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, fontSize: 10, fontWeight: '700', marginTop: 6, maxWidth: '100%' },
  ready: { color: '#8C5C13', backgroundColor: '#FAF0D7' },
  graded: { color: '#105F58', backgroundColor: '#E2F0EA' },
  missing: { color: '#95651D', backgroundColor: '#FAECC9' },
  compactStatus: { fontSize: 8, paddingHorizontal: 4, paddingVertical: 3, marginTop: 4 },
});
