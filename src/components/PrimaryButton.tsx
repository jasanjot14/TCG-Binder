import { Pressable, StyleSheet, Text } from 'react-native';

type Props = { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean };
export function PrimaryButton({ label, onPress, secondary = false, disabled = false }: Props) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [
      styles.button, secondary && styles.secondary, (pressed || disabled) && styles.fade,
    ]}>
      <Text style={[styles.label, secondary && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: { minHeight: 54, borderRadius: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: '#6C5CE7', paddingHorizontal: 18 },
  secondary: { backgroundColor: '#F1EFFE' }, fade: { opacity: 0.78 },
  label: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  secondaryLabel: { color: '#6C5CE7' },
});
