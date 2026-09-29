//! Thin WASM wrapper around vodozemac (Olm and Megolm).
//! Keys cross the boundary as base64 text. Olm ciphertext crosses as bytes.
//! Pickles are encrypted with a 32-byte key that the caller supplies.
//! See docs/concepts/olm-megolm.md for the protocol that uses these types.

mod backup;
mod sas;

pub use backup::{backup_encrypt, derive_recovery_key, BackupKey};
pub use sas::{EstablishedSas, Sas};

use vodozemac::megolm::{
    ExportedSessionKey, GroupSession as MGroupSession, GroupSessionPickle,
    InboundGroupSession as MInboundGroupSession, InboundGroupSessionPickle, MegolmMessage,
    SessionConfig as MegolmConfig, SessionKey,
};
use vodozemac::olm::{
    Account as OAccount, AccountPickle, OlmMessage, Session as OSession, SessionConfig,
    SessionPickle,
};
use vodozemac::hazmat::Cipher;
use vodozemac::{Curve25519PublicKey, Ed25519PublicKey, Ed25519SecretKey, Ed25519Signature};
use wasm_bindgen::prelude::*;

type Result<T> = std::result::Result<T, JsError>;

fn err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn pickle_key(key: &[u8]) -> Result<[u8; 32]> {
    key.try_into().map_err(|_| JsError::new("pickle key must be 32 bytes"))
}

fn curve_key(b64: &str) -> Result<Curve25519PublicKey> {
    Curve25519PublicKey::from_base64(b64).map_err(err)
}

/// Writes a JSON object: key id to base64 public key. Ids and keys are base64,
/// so they need no JSON escapes.
fn key_map_json(keys: impl Iterator<Item = (String, String)>) -> String {
    let mut out = String::from("{");
    for (i, (id, key)) in keys.enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!("\"{id}\":\"{key}\""));
    }
    out.push('}');
    out
}

/// Verifies an Ed25519 signature. Returns false for a bad key, a bad
/// signature or a signature that does not match.
#[wasm_bindgen]
pub fn verify(public_key: &str, message: &str, signature: &str) -> bool {
    let Ok(key) = Ed25519PublicKey::from_base64(public_key) else {
        return false;
    };
    let Ok(sig) = Ed25519Signature::from_base64(signature) else {
        return false;
    };
    key.verify(message.as_bytes(), &sig).is_ok()
}

/// The long-term identity of one device.
#[wasm_bindgen]
pub struct Account(OAccount);

#[wasm_bindgen]
impl Account {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Account {
        Account(OAccount::new())
    }

    pub fn from_pickle(pickle: &str, key: &[u8]) -> Result<Account> {
        let p = AccountPickle::from_encrypted(pickle, &pickle_key(key)?).map_err(err)?;
        Ok(Account(OAccount::from_pickle(p)))
    }

    pub fn pickle(&self, key: &[u8]) -> Result<String> {
        Ok(self.0.pickle().encrypt(&pickle_key(key)?))
    }

    #[wasm_bindgen(getter)]
    pub fn curve25519_key(&self) -> String {
        self.0.curve25519_key().to_base64()
    }

    #[wasm_bindgen(getter)]
    pub fn ed25519_key(&self) -> String {
        self.0.ed25519_key().to_base64()
    }

    pub fn sign(&self, message: &str) -> String {
        self.0.sign(message).to_base64()
    }

    pub fn generate_one_time_keys(&mut self, count: usize) {
        self.0.generate_one_time_keys(count);
    }

    /// Returns a JSON object: key id to base64 public key. Only keys that
    /// are not published yet are in it.
    pub fn one_time_keys(&self) -> String {
        key_map_json(self.0.one_time_keys().iter().map(|(id, key)| (id.to_base64(), key.to_base64())))
    }

    /// The number of one-time keys that the server should keep for this account.
    #[wasm_bindgen(getter)]
    pub fn max_number_of_one_time_keys(&self) -> usize {
        self.0.max_number_of_one_time_keys()
    }

    /// Makes a new fallback key. The account keeps the previous one, so a
    /// late message that uses it still decrypts.
    pub fn generate_fallback_key(&mut self) {
        self.0.generate_fallback_key();
    }

    /// Returns a JSON object with the unpublished fallback key, or `{}`.
    pub fn fallback_key(&self) -> String {
        key_map_json(self.0.fallback_key().iter().map(|(id, key)| (id.to_base64(), key.to_base64())))
    }

    /// Forgets the previous fallback key. Returns true if there was one.
    pub fn forget_fallback_key(&mut self) -> bool {
        self.0.forget_fallback_key()
    }

    /// Marks all one-time keys and the fallback key as published.
    pub fn mark_keys_as_published(&mut self) {
        self.0.mark_keys_as_published();
    }

    pub fn create_outbound_session(&self, identity_key: &str, one_time_key: &str) -> Result<Session> {
        let s = self.0.create_outbound_session(
            SessionConfig::version_1(),
            curve_key(identity_key)?,
            curve_key(one_time_key)?,
        ).map_err(err)?;
        Ok(Session(s))
    }

    /// Creates a session from the first message of the other device.
    /// Get the session with `take_session`. The first plaintext is in `plaintext`.
    pub fn create_inbound_session(
        &mut self,
        identity_key: &str,
        message_type: usize,
        ciphertext: &[u8],
    ) -> Result<InboundResult> {
        let msg = OlmMessage::from_parts(message_type, ciphertext).map_err(err)?;
        let OlmMessage::PreKey(pre) = msg else {
            return Err(JsError::new("message is not a pre-key message"));
        };
        let r = self.0.create_inbound_session(SessionConfig::version_1(), curve_key(identity_key)?, &pre).map_err(err)?;
        Ok(InboundResult { session: Some(Session(r.session)), plaintext: r.plaintext })
    }
}

impl Default for Account {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
pub struct InboundResult {
    session: Option<Session>,
    plaintext: Vec<u8>,
}

#[wasm_bindgen]
impl InboundResult {
    /// Gives the session to the caller. Call this only one time.
    pub fn take_session(&mut self) -> Result<Session> {
        self.session.take().ok_or_else(|| JsError::new("session was already taken"))
    }

    #[wasm_bindgen(getter)]
    pub fn plaintext(&self) -> Vec<u8> {
        self.plaintext.clone()
    }
}

/// An Olm session between two devices.
#[wasm_bindgen]
pub struct Session(OSession);

#[wasm_bindgen]
pub struct Encrypted {
    #[wasm_bindgen(readonly)]
    pub message_type: usize,
    ciphertext: Vec<u8>,
}

#[wasm_bindgen]
impl Encrypted {
    #[wasm_bindgen(getter)]
    pub fn ciphertext(&self) -> Vec<u8> {
        self.ciphertext.clone()
    }
}

#[wasm_bindgen]
impl Session {
    pub fn from_pickle(pickle: &str, key: &[u8]) -> Result<Session> {
        let p = SessionPickle::from_encrypted(pickle, &pickle_key(key)?).map_err(err)?;
        Ok(Session(OSession::from_pickle(p)))
    }

    pub fn pickle(&self, key: &[u8]) -> Result<String> {
        Ok(self.0.pickle().encrypt(&pickle_key(key)?))
    }

    #[wasm_bindgen(getter)]
    pub fn session_id(&self) -> String {
        self.0.session_id()
    }

    /// True when this pre-key message belongs to this session. Returns
    /// false for a normal message or a message that is not valid.
    pub fn session_matches(&self, message_type: usize, ciphertext: &[u8]) -> bool {
        match OlmMessage::from_parts(message_type, ciphertext) {
            Ok(OlmMessage::PreKey(pre)) => pre.session_keys() == self.0.session_keys(),
            _ => false,
        }
    }

    /// True after the session decrypted a message from the other device.
    #[wasm_bindgen(getter)]
    pub fn has_received_message(&self) -> bool {
        self.0.has_received_message()
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Encrypted> {
        let (message_type, ciphertext) = self.0.encrypt(plaintext).map_err(err)?.to_parts();
        Ok(Encrypted { message_type, ciphertext })
    }

    pub fn decrypt(&mut self, message_type: usize, ciphertext: &[u8]) -> Result<Vec<u8>> {
        let msg = OlmMessage::from_parts(message_type, ciphertext).map_err(err)?;
        self.0.decrypt(&msg).map_err(err)
    }
}

/// A standalone Ed25519 key pair. The user master key uses it.
#[wasm_bindgen]
pub struct SigningKey(Ed25519SecretKey);

#[wasm_bindgen]
impl SigningKey {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SigningKey {
        SigningKey(Ed25519SecretKey::new())
    }

    /// Encrypts the secret key with the pickle key (the vodozemac pickle cipher).
    pub fn pickle(&self, key: &[u8]) -> Result<String> {
        let cipher = Cipher::new_pickle(&pickle_key(key)?);
        Ok(vodozemac::base64_encode(cipher.encrypt_pickle(self.0.to_bytes().as_slice())))
    }

    pub fn from_pickle(pickle: &str, key: &[u8]) -> Result<SigningKey> {
        let cipher = Cipher::new_pickle(&pickle_key(key)?);
        let bytes = vodozemac::base64_decode(pickle).map_err(err)?;
        let plain = cipher.decrypt_pickle(&bytes).map_err(|_| JsError::new("the pickle could not be decrypted"))?;
        let secret: [u8; 32] = plain.as_slice().try_into().map_err(|_| JsError::new("the pickle is not a signing key"))?;
        Ok(SigningKey(Ed25519SecretKey::from_slice(&secret)))
    }

    /// The 32 secret bytes. Only the key backup uses this, and it encrypts them at once.
    pub fn export_secret(&self) -> Vec<u8> {
        self.0.to_bytes().to_vec()
    }

    /// The key from 32 secret bytes, for example from the key backup.
    pub fn from_secret(secret: &[u8]) -> Result<SigningKey> {
        let bytes: [u8; 32] = secret.try_into().map_err(|_| JsError::new("a signing key must be 32 bytes"))?;
        Ok(SigningKey(Ed25519SecretKey::from_slice(&bytes)))
    }

    #[wasm_bindgen(getter)]
    pub fn public_key(&self) -> String {
        self.0.public_key().to_base64()
    }

    pub fn sign(&self, message: &str) -> String {
        self.0.sign(message.as_bytes()).to_base64()
    }
}

impl Default for SigningKey {
    fn default() -> Self {
        Self::new()
    }
}

/// The send side of a Megolm session. One device owns it for one channel.
#[wasm_bindgen]
pub struct GroupSession(MGroupSession);

#[wasm_bindgen]
impl GroupSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> GroupSession {
        GroupSession(MGroupSession::new(MegolmConfig::version_1()))
    }

    pub fn from_pickle(pickle: &str, key: &[u8]) -> Result<GroupSession> {
        let p = GroupSessionPickle::from_encrypted(pickle, &pickle_key(key)?).map_err(err)?;
        Ok(GroupSession(MGroupSession::from_pickle(p)))
    }

    pub fn pickle(&self, key: &[u8]) -> Result<String> {
        Ok(self.0.pickle().encrypt(&pickle_key(key)?))
    }

    #[wasm_bindgen(getter)]
    pub fn session_id(&self) -> String {
        self.0.session_id()
    }

    #[wasm_bindgen(getter)]
    pub fn message_index(&self) -> u32 {
        self.0.message_index()
    }

    /// The key to send to other devices (through Olm) so that they can decrypt.
    #[wasm_bindgen(getter)]
    pub fn session_key(&self) -> String {
        self.0.session_key().to_base64()
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> String {
        self.0.encrypt(plaintext).to_base64()
    }
}

impl Default for GroupSession {
    fn default() -> Self {
        Self::new()
    }
}

/// The receive side of a Megolm session.
#[wasm_bindgen]
pub struct InboundGroupSession(MInboundGroupSession);

#[wasm_bindgen]
pub struct Decrypted {
    plaintext: Vec<u8>,
    #[wasm_bindgen(readonly)]
    pub message_index: u32,
}

#[wasm_bindgen]
impl Decrypted {
    #[wasm_bindgen(getter)]
    pub fn plaintext(&self) -> Vec<u8> {
        self.plaintext.clone()
    }
}

#[wasm_bindgen]
impl InboundGroupSession {
    /// Creates the session from a key that the sender shared directly.
    #[wasm_bindgen(constructor)]
    pub fn new(session_key: &str) -> Result<InboundGroupSession> {
        let key = SessionKey::from_base64(session_key).map_err(err)?;
        Ok(InboundGroupSession(MInboundGroupSession::new(&key, MegolmConfig::version_1())))
    }

    /// Creates the session from an exported key (history share or backup).
    pub fn import(exported_key: &str) -> Result<InboundGroupSession> {
        let key = ExportedSessionKey::from_base64(exported_key).map_err(err)?;
        Ok(InboundGroupSession(MInboundGroupSession::import(&key, MegolmConfig::version_1())))
    }

    pub fn from_pickle(pickle: &str, key: &[u8]) -> Result<InboundGroupSession> {
        let p = InboundGroupSessionPickle::from_encrypted(pickle, &pickle_key(key)?).map_err(err)?;
        Ok(InboundGroupSession(MInboundGroupSession::from_pickle(p)))
    }

    pub fn pickle(&self, key: &[u8]) -> Result<String> {
        Ok(self.0.pickle().encrypt(&pickle_key(key)?))
    }

    #[wasm_bindgen(getter)]
    pub fn session_id(&self) -> String {
        self.0.session_id()
    }

    #[wasm_bindgen(getter)]
    pub fn first_known_index(&self) -> u32 {
        self.0.first_known_index()
    }

    /// Exports the key from `index`. Returns undefined if the index is too old.
    pub fn export_at(&mut self, index: u32) -> Option<String> {
        self.0.export_at(index).map(|k| k.to_base64())
    }

    pub fn decrypt(&mut self, ciphertext: &str) -> Result<Decrypted> {
        let msg = MegolmMessage::from_base64(ciphertext).map_err(err)?;
        let d = self.0.decrypt(&msg).map_err(err)?;
        Ok(Decrypted { plaintext: d.plaintext, message_index: d.message_index })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn olm_and_megolm_round_trip() {
        let alice = OAccount::new();
        let mut bob = OAccount::new();
        bob.generate_one_time_keys(1);
        let otk = *bob.one_time_keys().values().next().unwrap();

        let mut a = alice.create_outbound_session(SessionConfig::version_1(), bob.curve25519_key(), otk).unwrap();
        let OlmMessage::PreKey(pre) = a.encrypt("hello").unwrap() else { panic!("first message must be pre-key") };
        let r = bob.create_inbound_session(SessionConfig::version_1(), alice.curve25519_key(), &pre).unwrap();
        assert_eq!(r.plaintext, b"hello");

        let mut out = MGroupSession::new(MegolmConfig::version_1());
        let mut inb = MInboundGroupSession::new(&out.session_key(), MegolmConfig::version_1());
        let m = out.encrypt("channel text");
        assert_eq!(inb.decrypt(&m).unwrap().plaintext, b"channel text");

        // A late member gets the key from index 0 and reads the old message.
        let exported = inb.export_at(0).unwrap();
        let mut late = MInboundGroupSession::import(&exported, MegolmConfig::version_1());
        assert_eq!(late.decrypt(&m).unwrap().plaintext, b"channel text");
    }

    #[test]
    fn verify_accepts_a_good_signature_and_rejects_the_rest() {
        let account = Account::new();
        let sig = account.sign("message");
        assert!(verify(&account.ed25519_key(), "message", &sig));
        assert!(!verify(&account.ed25519_key(), "other message", &sig));
        assert!(!verify(&Account::new().ed25519_key(), "message", &sig));
        assert!(!verify("not a key", "message", &sig));
        assert!(!verify(&account.ed25519_key(), "message", "not a signature"));
    }

    #[test]
    fn fallback_key_is_listed_until_published() {
        let mut account = Account::new();
        assert_eq!(account.fallback_key(), "{}");
        account.generate_fallback_key();
        assert!(account.fallback_key().starts_with("{\""));
        account.mark_keys_as_published();
        assert_eq!(account.fallback_key(), "{}");
        assert_eq!(account.max_number_of_one_time_keys(), 50);
    }

    #[test]
    fn fallback_key_makes_an_inbound_session_and_old_one_still_works() {
        let alice = OAccount::new();
        let mut bob = OAccount::new();
        bob.generate_fallback_key();
        let old = *bob.fallback_key().values().next().unwrap();
        bob.mark_keys_as_published();
        bob.generate_fallback_key();

        let mut a = alice.create_outbound_session(SessionConfig::version_1(), bob.curve25519_key(), old).unwrap();
        let OlmMessage::PreKey(pre) = a.encrypt("late").unwrap() else { panic!("expected a pre-key message") };
        let r = bob.create_inbound_session(SessionConfig::version_1(), alice.curve25519_key(), &pre).unwrap();
        assert_eq!(r.plaintext, b"late");
    }

    #[test]
    fn session_matches_only_its_own_pre_key_messages() {
        let alice = OAccount::new();
        let mut bob = OAccount::new();
        bob.generate_one_time_keys(2);
        let keys: Vec<_> = bob.one_time_keys().values().copied().collect();

        let mut first = alice.create_outbound_session(SessionConfig::version_1(), bob.curve25519_key(), keys[0]).unwrap();
        let mut second = alice.create_outbound_session(SessionConfig::version_1(), bob.curve25519_key(), keys[1]).unwrap();
        let OlmMessage::PreKey(pre) = first.encrypt("one").unwrap() else { panic!("expected a pre-key message") };
        let r = bob.create_inbound_session(SessionConfig::version_1(), alice.curve25519_key(), &pre).unwrap();
        let inbound = Session(r.session);

        let again = first.encrypt("two").unwrap().to_parts();
        let other = second.encrypt("three").unwrap().to_parts();
        assert!(inbound.session_matches(again.0, &again.1));
        assert!(!inbound.session_matches(other.0, &other.1));
        assert!(!inbound.session_matches(1, &again.1));
    }

    #[test]
    fn signing_key_signs_and_survives_a_pickle() {
        let key = [7u8; 32];
        let master = SigningKey::new();
        let sig = master.sign("device keys");
        assert!(verify(&master.public_key(), "device keys", &sig));

        let copy = SigningKey::from_pickle(&master.pickle(&key).unwrap(), &key).unwrap();
        assert_eq!(copy.public_key(), master.public_key());

        let restored = SigningKey::from_secret(&master.export_secret()).unwrap();
        assert_eq!(restored.public_key(), master.public_key());
    }
}
