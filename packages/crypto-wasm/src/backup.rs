//! The key backup: the backup key pair that comes from the recovery key,
//! the backup encryption (X25519 + HKDF-SHA256 + AES-256-GCM) and the
//! Argon2id derivation of a recovery key from a passphrase.
//! See docs/concepts/olm-megolm.md section 9 for the format.
//! The Rust functions return a plain error text, so the native tests can
//! check the errors. The WASM functions change it to a JavaScript error.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use sha2::Sha256;
use vodozemac::{Curve25519PublicKey, Curve25519SecretKey};
use wasm_bindgen::prelude::*;

type Plain<T> = std::result::Result<T, &'static str>;

/// The first byte of each backup ciphertext.
const FORMAT_VERSION: u8 = 1;
const KEY_INFO: &[u8] = b"discord-clone:backup-key:v1";
const ENCRYPT_INFO: &[u8] = b"discord-clone:backup-ecies:v1";
const PUBLIC_KEY_BYTES: usize = 32;
const TAG_BYTES: usize = 16;
/// The limits of the Argon2id parameters. The server stores the parameters,
/// so a malicious server must not make the client use all its memory.
const MIN_MEMORY_KIB: u32 = 8 * 1024;
const MAX_MEMORY_KIB: u32 = 256 * 1024;
const MAX_ITERATIONS: u32 = 10;
const MAX_PARALLELISM: u32 = 4;

fn js(message: &'static str) -> JsError {
    JsError::new(message)
}

/// The backup secret key: HKDF-SHA256 of the recovery key with no salt.
fn backup_secret(recovery_key: &[u8]) -> Plain<Curve25519SecretKey> {
    let recovery: &[u8; 32] = recovery_key.try_into().map_err(|_| "the recovery key must be 32 bytes")?;
    let mut secret = [0u8; 32];
    Hkdf::<Sha256>::new(None, recovery)
        .expand(KEY_INFO, &mut secret)
        .map_err(|_| "the backup key could not be made")?;
    let key = Curve25519SecretKey::from_slice(&secret);
    secret.fill(0);
    Ok(key)
}

/// The AES-256-GCM key and nonce of one message. The ephemeral key is new
/// for each message, so the nonce never repeats for one AES key.
fn message_cipher(shared: &[u8; 32], ephemeral: &Curve25519PublicKey, recipient: &Curve25519PublicKey) -> Plain<(Aes256Gcm, [u8; 12])> {
    let mut salt = [0u8; 2 * PUBLIC_KEY_BYTES];
    salt[..PUBLIC_KEY_BYTES].copy_from_slice(ephemeral.as_bytes());
    salt[PUBLIC_KEY_BYTES..].copy_from_slice(recipient.as_bytes());
    let mut okm = [0u8; 44];
    Hkdf::<Sha256>::new(Some(&salt), shared)
        .expand(ENCRYPT_INFO, &mut okm)
        .map_err(|_| "the message key could not be made")?;
    let cipher = Aes256Gcm::new_from_slice(&okm[..32]).map_err(|_| "the message key could not be made")?;
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&okm[32..]);
    okm.fill(0);
    Ok((cipher, nonce))
}

/// Encrypt with a given ephemeral secret. The tests use a fixed one.
fn encrypt_with(ephemeral: &Curve25519SecretKey, recipient: &Curve25519PublicKey, plaintext: &[u8], aad: &[u8]) -> Plain<Vec<u8>> {
    let ephemeral_public = Curve25519PublicKey::from(ephemeral);
    let shared = ephemeral.diffie_hellman(recipient).ok_or("the backup public key is not valid")?;
    let (cipher, nonce) = message_cipher(shared.as_bytes(), &ephemeral_public, recipient)?;
    let ciphertext = cipher
        .encrypt(&Nonce::from(nonce), Payload { msg: plaintext, aad })
        .map_err(|_| "the backup encryption failed")?;
    let mut out = Vec::with_capacity(1 + PUBLIC_KEY_BYTES + ciphertext.len());
    out.push(FORMAT_VERSION);
    out.extend_from_slice(ephemeral_public.as_bytes());
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt_with(secret: &Curve25519SecretKey, ciphertext: &[u8], aad: &[u8]) -> Plain<Vec<u8>> {
    if ciphertext.len() < 1 + PUBLIC_KEY_BYTES + TAG_BYTES || ciphertext[0] != FORMAT_VERSION {
        return Err("the backup data has an unknown format");
    }
    let ephemeral = Curve25519PublicKey::from_slice(&ciphertext[1..1 + PUBLIC_KEY_BYTES]).map_err(|_| "the backup data is not valid")?;
    let shared = secret.diffie_hellman(&ephemeral).ok_or("the backup data is not valid")?;
    let (cipher, nonce) = message_cipher(shared.as_bytes(), &ephemeral, &Curve25519PublicKey::from(secret))?;
    cipher
        .decrypt(&Nonce::from(nonce), Payload { msg: &ciphertext[1 + PUBLIC_KEY_BYTES..], aad })
        .map_err(|_| "the backup data could not be decrypted")
}

fn derive(passphrase: &str, salt: &[u8], memory_kib: u32, iterations: u32, parallelism: u32) -> Plain<Vec<u8>> {
    if !(MIN_MEMORY_KIB..=MAX_MEMORY_KIB).contains(&memory_kib)
        || !(1..=MAX_ITERATIONS).contains(&iterations)
        || !(1..=MAX_PARALLELISM).contains(&parallelism)
        || !(16..=64).contains(&salt.len())
    {
        return Err("the passphrase parameters are out of range");
    }
    let params = Params::new(memory_kib, iterations, parallelism, Some(32)).map_err(|_| "the passphrase parameters are not valid")?;
    let mut out = vec![0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, &mut out)
        .map_err(|_| "the passphrase could not be used")?;
    Ok(out)
}

/// Encrypt `plaintext` to the backup public key. `aad` is authenticated but
/// not encrypted. Output: the version byte, the ephemeral public key, then
/// the AES-256-GCM ciphertext and tag.
#[wasm_bindgen]
pub fn backup_encrypt(public_key: &str, plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, JsError> {
    let recipient = Curve25519PublicKey::from_base64(public_key).map_err(|_| js("the backup public key is not valid"))?;
    encrypt_with(&Curve25519SecretKey::new(), &recipient, plaintext, aad).map_err(js)
}

/// Derive a recovery key from a passphrase with Argon2id (version 0x13, 32-byte output).
#[wasm_bindgen]
pub fn derive_recovery_key(passphrase: &str, salt: &[u8], memory_kib: u32, iterations: u32, parallelism: u32) -> Result<Vec<u8>, JsError> {
    derive(passphrase, salt, memory_kib, iterations, parallelism).map_err(js)
}

/// The backup key pair that comes from one recovery key.
#[wasm_bindgen]
pub struct BackupKey(Curve25519SecretKey);

#[wasm_bindgen]
impl BackupKey {
    #[wasm_bindgen(constructor)]
    pub fn new(recovery_key: &[u8]) -> Result<BackupKey, JsError> {
        Ok(BackupKey(backup_secret(recovery_key).map_err(js)?))
    }

    #[wasm_bindgen(getter)]
    pub fn public_key(&self) -> String {
        Curve25519PublicKey::from(&self.0).to_base64()
    }

    /// Decrypt one backup ciphertext. It fails for a wrong key, a wrong
    /// `aad`, a changed byte or an unknown format.
    pub fn decrypt(&self, ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, JsError> {
        decrypt_with(&self.0, ciphertext, aad).map_err(js)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn public_of(secret: &Curve25519SecretKey) -> Curve25519PublicKey {
        Curve25519PublicKey::from(secret)
    }

    #[test]
    fn round_trip_and_tamper_rejection() {
        let secret = backup_secret(&[1u8; 32]).unwrap();
        let recipient = public_of(&secret);
        let sealed = encrypt_with(&Curve25519SecretKey::new(), &recipient, b"session data", b"aad").unwrap();
        assert_eq!(decrypt_with(&secret, &sealed, b"aad").unwrap(), b"session data");

        // A wrong associated data, a wrong key and each changed byte are rejected.
        assert!(decrypt_with(&secret, &sealed, b"other aad").is_err());
        assert!(decrypt_with(&backup_secret(&[2u8; 32]).unwrap(), &sealed, b"aad").is_err());
        for index in 0..sealed.len() {
            let mut changed = sealed.clone();
            changed[index] ^= 0x01;
            assert!(decrypt_with(&secret, &changed, b"aad").is_err(), "byte {index} was not checked");
        }
        assert!(decrypt_with(&secret, &sealed[..40], b"aad").is_err());
        // Two encryptions of the same data differ: each one has a new ephemeral key.
        assert_ne!(sealed, encrypt_with(&Curve25519SecretKey::new(), &recipient, b"session data", b"aad").unwrap());
        assert!(backup_secret(&[1u8; 31]).is_err());
    }

    #[test]
    fn test_vectors() {
        // The recovery key is 0x00..0x1f. The ephemeral secret is 0x20..0x3f.
        // An independent check with node:crypto gave the same values.
        let recovery: Vec<u8> = (0u8..32).collect();
        let ephemeral: [u8; 32] = core::array::from_fn(|i| 32 + i as u8);
        let secret = backup_secret(&recovery).unwrap();
        assert_eq!(public_of(&secret).to_base64(), "iTecjG4B1pHHxDvt59kBNsz3Q1y9IQneI+MCzAXc3H0");

        let sealed = encrypt_with(&Curve25519SecretKey::from_slice(&ephemeral), &public_of(&secret), b"hello", b"aad").unwrap();
        assert_eq!(hex(&sealed), "01358072d6365880d1aeea329adf9121383851ed21a28e3b75e965d0d2cd16625498ac280d771a0c8c3158d5baf5f02e74f680c96a61");
        assert_eq!(decrypt_with(&secret, &sealed, b"aad").unwrap(), b"hello");
    }

    #[test]
    fn passphrase_derivation_vector_and_limits() {
        let salt = [7u8; 16];
        let derived = derive("correct horse battery staple", &salt, 64 * 1024, 3, 1).unwrap();
        // An independent check with the argon2 reference code gave the same value.
        assert_eq!(hex(&derived), "6ad10af97f1744119bd7135c85121dc589794f9c5d646200b8ad4d6becf15084");
        assert_ne!(derived, derive("correct horse battery stapler", &salt, 64 * 1024, 3, 1).unwrap());
        assert!(derive("x", &salt, 1024 * 1024, 3, 1).is_err());
        assert!(derive("x", &[0u8; 8], 64 * 1024, 3, 1).is_err());
        assert!(derive("x", &salt, 64 * 1024, 0, 1).is_err());
    }
}
