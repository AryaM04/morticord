//! Thin WASM wrapper around vodozemac (Olm and Megolm).
//! Keys cross the boundary as base64 text. Olm ciphertext crosses as bytes.
//! Pickles are encrypted with a 32-byte key that the caller supplies.

use vodozemac::megolm::{
    ExportedSessionKey, GroupSession as MGroupSession, GroupSessionPickle,
    InboundGroupSession as MInboundGroupSession, InboundGroupSessionPickle, MegolmMessage,
    SessionConfig as MegolmConfig, SessionKey,
};
use vodozemac::olm::{
    Account as OAccount, AccountPickle, OlmMessage, Session as OSession, SessionConfig,
    SessionPickle,
};
use vodozemac::Curve25519PublicKey;
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

    /// Returns a JSON object: key id to base64 public key.
    pub fn one_time_keys(&self) -> String {
        let mut out = String::from("{");
        for (i, (id, key)) in self.0.one_time_keys().iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&format!("\"{}\":\"{}\"", id.to_base64(), key.to_base64()));
        }
        out.push('}');
        out
    }

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

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Encrypted> {
        let (message_type, ciphertext) = self.0.encrypt(plaintext).map_err(err)?.to_parts();
        Ok(Encrypted { message_type, ciphertext })
    }

    pub fn decrypt(&mut self, message_type: usize, ciphertext: &[u8]) -> Result<Vec<u8>> {
        let msg = OlmMessage::from_parts(message_type, ciphertext).map_err(err)?;
        self.0.decrypt(&msg).map_err(err)
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
}
