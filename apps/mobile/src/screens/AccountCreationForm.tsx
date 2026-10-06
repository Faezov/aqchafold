import { Account, type AccountType, Household } from "@aqchafold/domain";
import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type AccountCreationFormProps = {
  household: Household | undefined;
  onCreate: (account: Account, newHousehold?: Household) => void;
  onCreated: () => void;
  onCancel: () => void;
};

const accountTypes: readonly { value: AccountType; label: string }[] = [
  { value: "transaction", label: "Transaction" },
  { value: "savings", label: "Savings" },
  { value: "credit-card", label: "Credit card" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];
const ownershipChoices = ["household-level", "unknown"] as const;
const ownershipLabels = {
  "household-level": "Household-level",
  unknown: "Unknown",
};

export default function AccountCreationForm({
  household,
  onCreate,
  onCreated,
  onCancel,
}: AccountCreationFormProps) {
  const [accountId] = useState(randomUUID);
  const [newHouseholdId] = useState(() => household?.id ?? randomUUID());
  const [householdLabel, setHouseholdLabel] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [type, setType] = useState<AccountType | null>(null);
  const [currency, setCurrency] = useState("");
  const [ownership, setOwnership] = useState<
    (typeof ownershipChoices)[number] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitted = useRef(false);

  function submit() {
    if (submitted.current) return;
    let message: string | null = null;
    if (!household && !householdLabel.trim())
      message = "Enter a household label.";
    else if (!accountLabel.trim()) message = "Enter an account label.";
    else if (!type) message = "Choose an account type.";
    else if (!/^[A-Z]{3}$/.test(currency))
      message = "Enter a currency with three uppercase letters.";
    else if (!ownership) message = "Choose an ownership association.";
    if (message || !type || !ownership) {
      setError(message);
      return;
    }

    submitted.current = true;
    setSaving(true);
    setError(null);
    try {
      const newHousehold = household
        ? undefined
        : new Household({ id: newHouseholdId, label: householdLabel.trim() });
      const account = new Account({
        id: accountId,
        householdId: household?.id ?? newHouseholdId,
        label: accountLabel.trim(),
        type,
        status: "active",
        primaryCurrency: currency,
        ownership: { kind: ownership },
      });
      onCreate(account, newHousehold);
    } catch {
      submitted.current = false;
      setSaving(false);
      setError("The account could not be created. Please try again.");
      return;
    }
    // Persistence succeeded. Keep this form intent locked until the parent closes it.
    onCreated();
  }

  return (
    <ScrollView
      style={styles.form}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" style={styles.heading}>
        Create account
      </Text>
      {household ? (
        <Text style={styles.text}>Household: {household.label}</Text>
      ) : (
        <View style={styles.field}>
          <Text style={styles.text}>Household label</Text>
          <TextInput
            accessibilityLabel="Household label"
            value={householdLabel}
            onChangeText={setHouseholdLabel}
            editable={!saving}
            style={styles.input}
          />
        </View>
      )}
      <View style={styles.field}>
        <Text style={styles.text}>Account label</Text>
        <TextInput
          accessibilityLabel="Account label"
          value={accountLabel}
          onChangeText={setAccountLabel}
          editable={!saving}
          style={styles.input}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.text}>Account type</Text>
        {accountTypes.map((choice) => (
          <Pressable
            key={choice.value}
            onPress={() => setType(choice.value)}
            disabled={saving}
            accessibilityRole="radio"
            accessibilityLabel={`Account type ${choice.label}`}
            accessibilityState={{
              checked: type === choice.value,
              disabled: saving,
            }}
            style={styles.control}
          >
            <Text style={styles.text}>
              {choice.label}
              {type === choice.value ? " · Selected" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.field}>
        <Text style={styles.text}>Currency (three uppercase letters)</Text>
        <TextInput
          accessibilityLabel="Currency"
          value={currency}
          onChangeText={setCurrency}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!saving}
          style={styles.input}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.text}>Ownership</Text>
        {ownershipChoices.map((choice) => (
          <Pressable
            key={choice}
            onPress={() => setOwnership(choice)}
            disabled={saving}
            accessibilityRole="radio"
            accessibilityLabel={`Ownership ${ownershipLabels[choice]}`}
            accessibilityState={{
              checked: ownership === choice,
              disabled: saving,
            }}
            style={styles.control}
          >
            <Text style={styles.text}>
              {ownershipLabels[choice]}
              {ownership === choice ? " · Selected" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.text}>Status: Active</Text>
      {error && (
        <Text accessibilityRole="alert" style={styles.text}>
          {error}
        </Text>
      )}
      <Pressable
        onPress={submit}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Create account"
        accessibilityState={{ disabled: saving, busy: saving }}
        style={styles.control}
      >
        <Text style={styles.text}>
          {saving ? "Creating account…" : "Create account"}
        </Text>
      </Pressable>
      <Pressable
        onPress={onCancel}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Cancel account creation"
        accessibilityState={{ disabled: saving }}
        style={styles.control}
      >
        <Text style={styles.text}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1 },
  content: { gap: 16, paddingBottom: 48 },
  field: { gap: 8 },
  heading: { fontSize: 18, fontWeight: "600", color: "#111" },
  text: { fontSize: 16, color: "#333" },
  input: {
    borderWidth: 1,
    borderColor: "#888",
    padding: 12,
    fontSize: 16,
    color: "#333",
  },
  control: { borderWidth: 1, borderColor: "#888", padding: 12 },
});
