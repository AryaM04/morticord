/* tslint:disable */
/* eslint-disable */

/**
 * The long-term identity of one device.
 */
export class Account {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Creates a session from the first message of the other device.
     * Get the session with `take_session`. The first plaintext is in `plaintext`.
     */
    create_inbound_session(identity_key: string, message_type: number, ciphertext: Uint8Array): InboundResult;
    create_outbound_session(identity_key: string, one_time_key: string): Session;
    /**
     * Returns a JSON object with the unpublished fallback key, or `{}`.
     */
    fallback_key(): string;
    /**
     * Forgets the previous fallback key. Returns true if there was one.
     */
    forget_fallback_key(): boolean;
    static from_pickle(pickle: string, key: Uint8Array): Account;
    /**
     * Makes a new fallback key. The account keeps the previous one, so a
     * late message that uses it still decrypts.
     */
    generate_fallback_key(): void;
    generate_one_time_keys(count: number): void;
    /**
     * Marks all one-time keys and the fallback key as published.
     */
    mark_keys_as_published(): void;
    constructor();
    /**
     * Returns a JSON object: key id to base64 public key. Only keys that
     * are not published yet are in it.
     */
    one_time_keys(): string;
    pickle(key: Uint8Array): string;
    sign(message: string): string;
    readonly curve25519_key: string;
    readonly ed25519_key: string;
    /**
     * The number of one-time keys that the server should keep for this account.
     */
    readonly max_number_of_one_time_keys: number;
}

/**
 * The backup key pair that comes from one recovery key.
 */
export class BackupKey {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Decrypt one backup ciphertext. It fails for a wrong key, a wrong
     * `aad`, a changed byte or an unknown format.
     */
    decrypt(ciphertext: Uint8Array, aad: Uint8Array): Uint8Array;
    constructor(recovery_key: Uint8Array);
    readonly public_key: string;
}

export class Decrypted {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly plaintext: Uint8Array;
    readonly message_index: number;
}

export class Encrypted {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly ciphertext: Uint8Array;
    readonly message_type: number;
}

/**
 * One side of a SAS verification after the key exchange.
 */
export class EstablishedSas {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The MAC of `input`, as unpadded base64.
     */
    calculate_mac(input: string, info: string): string;
    /**
     * The 7 emoji indexes (0 to 63) of the Matrix emoji table for this `info`.
     */
    emoji_indices(info: string): Uint8Array;
    /**
     * True when `mac` is the MAC of `input` for this `info`.
     */
    verify_mac(input: string, info: string, mac: string): boolean;
}

/**
 * The send side of a Megolm session. One device owns it for one channel.
 */
export class GroupSession {
    free(): void;
    [Symbol.dispose](): void;
    encrypt(plaintext: Uint8Array): string;
    static from_pickle(pickle: string, key: Uint8Array): GroupSession;
    constructor();
    pickle(key: Uint8Array): string;
    readonly message_index: number;
    readonly session_id: string;
    /**
     * The key to send to other devices (through Olm) so that they can decrypt.
     */
    readonly session_key: string;
}

/**
 * The receive side of a Megolm session.
 */
export class InboundGroupSession {
    free(): void;
    [Symbol.dispose](): void;
    decrypt(ciphertext: string): Decrypted;
    /**
     * Exports the key from `index`. Returns undefined if the index is too old.
     */
    export_at(index: number): string | undefined;
    static from_pickle(pickle: string, key: Uint8Array): InboundGroupSession;
    /**
     * Creates the session from an exported key (history share or backup).
     */
    static import(exported_key: string): InboundGroupSession;
    /**
     * Creates the session from a key that the sender shared directly.
     */
    constructor(session_key: string);
    pickle(key: Uint8Array): string;
    readonly first_known_index: number;
    readonly session_id: string;
}

export class InboundResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Gives the session to the caller. Call this only one time.
     */
    take_session(): Session;
    readonly plaintext: Uint8Array;
}

/**
 * One side of a SAS verification before the key exchange.
 */
export class Sas {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Make the shared secret with the key of the other device. Call it one time only.
     */
    diffie_hellman(their_public_key: string): EstablishedSas;
    constructor();
    /**
     * The ephemeral Curve25519 public key to send to the other device.
     * It is empty after `diffie_hellman`.
     */
    readonly public_key: string;
}

/**
 * An Olm session between two devices.
 */
export class Session {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    decrypt(message_type: number, ciphertext: Uint8Array): Uint8Array;
    encrypt(plaintext: Uint8Array): Encrypted;
    static from_pickle(pickle: string, key: Uint8Array): Session;
    pickle(key: Uint8Array): string;
    /**
     * True when this pre-key message belongs to this session. Returns
     * false for a normal message or a message that is not valid.
     */
    session_matches(message_type: number, ciphertext: Uint8Array): boolean;
    /**
     * True after the session decrypted a message from the other device.
     */
    readonly has_received_message: boolean;
    readonly session_id: string;
}

/**
 * A standalone Ed25519 key pair. The user master key uses it.
 */
export class SigningKey {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The 32 secret bytes. Only the key backup uses this, and it encrypts them at once.
     */
    export_secret(): Uint8Array;
    static from_pickle(pickle: string, key: Uint8Array): SigningKey;
    /**
     * The key from 32 secret bytes, for example from the key backup.
     */
    static from_secret(secret: Uint8Array): SigningKey;
    constructor();
    /**
     * Encrypts the secret key with the pickle key (the vodozemac pickle cipher).
     */
    pickle(key: Uint8Array): string;
    sign(message: string): string;
    readonly public_key: string;
}

/**
 * Encrypt `plaintext` to the backup public key. `aad` is authenticated but
 * not encrypted. Output: the version byte, the ephemeral public key, then
 * the AES-256-GCM ciphertext and tag.
 */
export function backup_encrypt(public_key: string, plaintext: Uint8Array, aad: Uint8Array): Uint8Array;

/**
 * Derive a recovery key from a passphrase with Argon2id (version 0x13, 32-byte output).
 */
export function derive_recovery_key(passphrase: string, salt: Uint8Array, memory_kib: number, iterations: number, parallelism: number): Uint8Array;

/**
 * Verifies an Ed25519 signature. Returns false for a bad key, a bad
 * signature or a signature that does not match.
 */
export function verify(public_key: string, message: string, signature: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_account_free: (a: number, b: number) => void;
    readonly __wbg_backupkey_free: (a: number, b: number) => void;
    readonly __wbg_decrypted_free: (a: number, b: number) => void;
    readonly __wbg_encrypted_free: (a: number, b: number) => void;
    readonly __wbg_establishedsas_free: (a: number, b: number) => void;
    readonly __wbg_get_decrypted_message_index: (a: number) => number;
    readonly __wbg_get_encrypted_message_type: (a: number) => number;
    readonly __wbg_groupsession_free: (a: number, b: number) => void;
    readonly __wbg_inboundgroupsession_free: (a: number, b: number) => void;
    readonly __wbg_inboundresult_free: (a: number, b: number) => void;
    readonly __wbg_sas_free: (a: number, b: number) => void;
    readonly __wbg_session_free: (a: number, b: number) => void;
    readonly __wbg_signingkey_free: (a: number, b: number) => void;
    readonly account_create_inbound_session: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly account_create_outbound_session: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly account_curve25519_key: (a: number) => [number, number];
    readonly account_ed25519_key: (a: number) => [number, number];
    readonly account_fallback_key: (a: number) => [number, number];
    readonly account_forget_fallback_key: (a: number) => number;
    readonly account_from_pickle: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly account_generate_fallback_key: (a: number) => void;
    readonly account_generate_one_time_keys: (a: number, b: number) => void;
    readonly account_mark_keys_as_published: (a: number) => void;
    readonly account_max_number_of_one_time_keys: (a: number) => number;
    readonly account_new: () => number;
    readonly account_one_time_keys: (a: number) => [number, number];
    readonly account_pickle: (a: number, b: number, c: number) => [number, number, number, number];
    readonly account_sign: (a: number, b: number, c: number) => [number, number];
    readonly backup_encrypt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly backupkey_decrypt: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly backupkey_new: (a: number, b: number) => [number, number, number];
    readonly backupkey_public_key: (a: number) => [number, number];
    readonly decrypted_plaintext: (a: number) => [number, number];
    readonly derive_recovery_key: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly encrypted_ciphertext: (a: number) => [number, number];
    readonly establishedsas_calculate_mac: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly establishedsas_emoji_indices: (a: number, b: number, c: number) => [number, number];
    readonly establishedsas_verify_mac: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly groupsession_encrypt: (a: number, b: number, c: number) => [number, number];
    readonly groupsession_from_pickle: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly groupsession_message_index: (a: number) => number;
    readonly groupsession_new: () => number;
    readonly groupsession_pickle: (a: number, b: number, c: number) => [number, number, number, number];
    readonly groupsession_session_id: (a: number) => [number, number];
    readonly groupsession_session_key: (a: number) => [number, number];
    readonly inboundgroupsession_decrypt: (a: number, b: number, c: number) => [number, number, number];
    readonly inboundgroupsession_export_at: (a: number, b: number) => [number, number];
    readonly inboundgroupsession_first_known_index: (a: number) => number;
    readonly inboundgroupsession_from_pickle: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly inboundgroupsession_import: (a: number, b: number) => [number, number, number];
    readonly inboundgroupsession_new: (a: number, b: number) => [number, number, number];
    readonly inboundgroupsession_pickle: (a: number, b: number, c: number) => [number, number, number, number];
    readonly inboundgroupsession_session_id: (a: number) => [number, number];
    readonly inboundresult_plaintext: (a: number) => [number, number];
    readonly inboundresult_take_session: (a: number) => [number, number, number];
    readonly sas_diffie_hellman: (a: number, b: number, c: number) => [number, number, number];
    readonly sas_new: () => number;
    readonly sas_public_key: (a: number) => [number, number];
    readonly session_decrypt: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly session_encrypt: (a: number, b: number, c: number) => [number, number, number];
    readonly session_from_pickle: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly session_has_received_message: (a: number) => number;
    readonly session_pickle: (a: number, b: number, c: number) => [number, number, number, number];
    readonly session_session_id: (a: number) => [number, number];
    readonly session_session_matches: (a: number, b: number, c: number, d: number) => number;
    readonly signingkey_export_secret: (a: number) => [number, number];
    readonly signingkey_from_pickle: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly signingkey_from_secret: (a: number, b: number) => [number, number, number];
    readonly signingkey_new: () => number;
    readonly signingkey_pickle: (a: number, b: number, c: number) => [number, number, number, number];
    readonly signingkey_public_key: (a: number) => [number, number];
    readonly signingkey_sign: (a: number, b: number, c: number) => [number, number];
    readonly verify: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
