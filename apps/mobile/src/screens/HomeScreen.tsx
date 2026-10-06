import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
} from "react-native";

export default function HomeScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        Ledgerase
      </Text>
      <Text style={styles.description}>
        Your finances stay on this device. No account required.
      </Text>

      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityLabel="Accounts, not yet available"
        accessibilityState={{ disabled: true }}
        style={styles.destination}
      >
        <Text style={styles.destinationTitle}>Accounts</Text>
        <Text style={styles.unavailable}>Not yet available</Text>
      </Pressable>

      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityLabel="Transactions, not yet available"
        accessibilityState={{ disabled: true }}
        style={styles.destination}
      >
        <Text style={styles.destinationTitle}>Transactions</Text>
        <Text style={styles.unavailable}>Not yet available</Text>
      </Pressable>

      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityLabel="Import statement, not yet available"
        accessibilityState={{ disabled: true }}
        style={styles.destination}
      >
        <Text style={styles.destinationTitle}>Import statement</Text>
        <Text style={styles.unavailable}>Not yet available</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: (StatusBar.currentHeight ?? 0) + 24,
    paddingBottom: 48,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: "#111",
  },
  description: {
    fontSize: 16,
    color: "#333",
    marginBottom: 8,
  },
  destination: {
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#f3f3f3",
  },
  destinationTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#444",
  },
  unavailable: {
    fontSize: 14,
    color: "#555",
  },
});
