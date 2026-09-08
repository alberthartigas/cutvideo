import { invoke } from "@tauri-apps/api/core";

// Espejo de src-tauri/src/secrets.rs. El frontend nunca recibe el valor completo.
export type SecretKind = "api" | "license" | "session";

export interface SecretStatus {
  kind: SecretKind;
  id: string;
  present: boolean;
  /** "…ab12": últimos caracteres, para reconocer qué clave hay guardada. */
  hint: string | null;
}

export function secretSet(kind: SecretKind, id: string, value: string): Promise<SecretStatus> {
  return invoke<SecretStatus>("secret_set", { kind, id, value });
}

export function secretStatus(kind: SecretKind, id: string): Promise<SecretStatus> {
  return invoke<SecretStatus>("secret_status", { kind, id });
}

export function secretDelete(kind: SecretKind, id: string): Promise<void> {
  return invoke<void>("secret_delete", { kind, id });
}
