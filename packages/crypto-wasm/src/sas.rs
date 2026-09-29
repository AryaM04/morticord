//! Short authentication string (SAS) verification with vodozemac. Two
//! devices exchange public keys, show the same 7 emojis, and then MAC
//! their keys. See docs/concepts/olm-megolm.md section 10.

use vodozemac::sas::{EstablishedSas as VEstablishedSas, Mac, Sas as VSas};
use vodozemac::Curve25519PublicKey;
use wasm_bindgen::prelude::*;

/// One side of a SAS verification before the key exchange.
#[wasm_bindgen]
pub struct Sas(Option<VSas>);

#[wasm_bindgen]
impl Sas {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Sas {
        Sas(Some(VSas::new()))
    }

    /// The ephemeral Curve25519 public key to send to the other device.
    /// It is empty after `diffie_hellman`.
    #[wasm_bindgen(getter)]
    pub fn public_key(&self) -> String {
        self.0.as_ref().map(|sas| sas.public_key().to_base64()).unwrap_or_default()
    }

    /// Make the shared secret with the key of the other device. Call it one time only.
    pub fn diffie_hellman(&mut self, their_public_key: &str) -> Result<EstablishedSas, JsError> {
        let sas = self.0.take().ok_or_else(|| JsError::new("the SAS key exchange was already done"))?;
        let key = Curve25519PublicKey::from_base64(their_public_key).map_err(|_| JsError::new("the SAS public key is not valid"))?;
        sas.diffie_hellman(key).map(EstablishedSas).map_err(|_| JsError::new("the SAS public key is not valid"))
    }
}

impl Default for Sas {
    fn default() -> Self {
        Self::new()
    }
}

/// One side of a SAS verification after the key exchange.
#[wasm_bindgen]
pub struct EstablishedSas(VEstablishedSas);

#[wasm_bindgen]
impl EstablishedSas {
    /// The 7 emoji indexes (0 to 63) of the Matrix emoji table for this `info`.
    pub fn emoji_indices(&self, info: &str) -> Vec<u8> {
        self.0.bytes(info).emoji_indices().to_vec()
    }

    /// The MAC of `input`, as unpadded base64.
    pub fn calculate_mac(&self, input: &str, info: &str) -> String {
        self.0.calculate_mac(input, info).to_base64()
    }

    /// True when `mac` is the MAC of `input` for this `info`.
    pub fn verify_mac(&self, input: &str, info: &str, mac: &str) -> bool {
        match Mac::from_base64(mac) {
            Ok(tag) => self.0.verify_mac(input, info, &tag).is_ok(),
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_sides_show_the_same_emojis_and_accept_the_macs() {
        let mut alice = Sas::new();
        let mut bob = Sas::new();
        let alice_key = alice.public_key();
        let bob_key = bob.public_key();
        let alice = alice.0.take().unwrap().diffie_hellman(Curve25519PublicKey::from_base64(&bob_key).unwrap()).unwrap();
        let bob = bob.0.take().unwrap().diffie_hellman(Curve25519PublicKey::from_base64(&alice_key).unwrap()).unwrap();
        let (alice, bob) = (EstablishedSas(alice), EstablishedSas(bob));

        let emojis = alice.emoji_indices("info");
        assert_eq!(emojis.len(), 7);
        assert!(emojis.iter().all(|index| *index < 64));
        assert_eq!(emojis, bob.emoji_indices("info"));

        let mac = alice.calculate_mac("device key", "mac info");
        assert!(bob.verify_mac("device key", "mac info", &mac));
        assert!(!bob.verify_mac("other key", "mac info", &mac));
        assert!(!bob.verify_mac("device key", "other info", &mac));
        assert!(!bob.verify_mac("device key", "mac info", "not a mac"));
    }

    #[test]
    fn a_third_key_gives_different_emojis() {
        let alice = VSas::new();
        let bob = VSas::new();
        let mallory = VSas::new();
        let alice_key = alice.public_key();
        let bob_key = bob.public_key();
        let mallory_key = mallory.public_key();
        let alice_with_mallory = EstablishedSas(alice.diffie_hellman(mallory_key).unwrap());
        let bob_with_mallory = EstablishedSas(bob.diffie_hellman(mallory_key).unwrap());
        assert_ne!(alice_key, bob_key);
        assert_ne!(alice_with_mallory.emoji_indices("info"), bob_with_mallory.emoji_indices("info"));
    }
}
