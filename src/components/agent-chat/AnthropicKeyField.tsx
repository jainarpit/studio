import { useEffect, useState } from "react";
import { anthropicKeySaved, removeAnthropicKey, saveAnthropicKey } from "../../lib/acpProcess";

/** A message from a failed keychain call, which never contains the key. */
function keyError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

interface Props {
  /** Called with whether a key is saved: once it's known, and after each change. */
  onSaved?: (saved: boolean) => void;
}

/**
 * The field for Claude Agent's Anthropic API key, used in Settings and in the
 * chat panel's setup. The key goes to the operating system's credential store;
 * once saved, this only ever knows that there is one.
 */
export function AnthropicKeyField({ onSaved }: Props) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    anthropicKeySaved()
      .then((known) => {
        setSaved(known);
        onSaved?.(known);
      })
      .catch((err) => setError(`Couldn't read the credential store: ${keyError(err)}`));
    // Read once; later changes come from this field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (work: () => Promise<void>, after: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setSaved(after);
      setValue("");
      onSaved?.(after);
    } catch (err) {
      setError(keyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <dl className="settings-facts">
        <dt>Key</dt>
        <dd>{saved === null ? "…" : saved ? "Saved" : "Not saved"}</dd>
      </dl>
      <div className="settings-actions">
        <input
          type="password"
          value={value}
          aria-label="Anthropic API key"
          placeholder={saved ? "Paste a new key to replace it" : "sk-ant-…"}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          className="btn primary"
          disabled={busy || !value.trim()}
          onClick={() => void run(() => saveAnthropicKey(value), true)}
        >
          Save
        </button>
        {saved && (
          <button className="btn ghost" disabled={busy} onClick={() => void run(removeAnthropicKey, false)}>
            Remove
          </button>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}
    </>
  );
}
