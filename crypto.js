// Stackroom v4.1 — Privacy Core
// Browser-side encryption helpers using the Web Crypto API.
// Plaintext project content and the vault passphrase never need to reach the server.

const StackroomCrypto = (() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const DEFAULT_ITERATIONS = 600000;
  const MIN_ITERATIONS = 100000;
  const MAX_ITERATIONS = 5000000;
  const CRYPTO_VERSION = 1;

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function validateIterations(iterations) {
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
      throw new Error('Unsupported PBKDF2 iteration count.');
    }
  }

  async function deriveWrappingKey(passphrase, salt, iterations = DEFAULT_ITERATIONS) {
    if (typeof passphrase !== 'string' || !passphrase.length) {
      throw new Error('Vault passphrase is required.');
    }

    validateIterations(iterations);

    const passphraseBytes = encoder.encode(passphrase);
    passphrase = '';
    let keyMaterial;
    try {
      keyMaterial = await crypto.subtle.importKey(
        'raw', passphraseBytes, 'PBKDF2', false, ['deriveKey']
      );
    } finally {
      passphraseBytes.fill(0);
    }

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function generateExportableMasterKey() {
    return crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async function exportMasterKey(masterKey) {
    const raw = await crypto.subtle.exportKey('raw', masterKey);
    return new Uint8Array(raw);
  }

  async function importMasterKey(rawBytes) {
    return crypto.subtle.importKey(
      'raw',
      rawBytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptBytes(key, plaintextBytes) {
    const iv = randomBytes(12);

    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      plaintextBytes
    );

    return {
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      iv: bytesToBase64(iv),
    };
  }

  async function decryptBytes(key, ciphertextBase64, ivBase64) {
    const ciphertext = base64ToBytes(ciphertextBase64);
    const iv = base64ToBytes(ivBase64);

    if (iv.length !== 12) {
      throw new Error('Invalid AES-GCM IV.');
    }

    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      ciphertext
    );

    return new Uint8Array(plaintext);
  }

  async function createVault(passphrase) {
    const salt = randomBytes(16);
    const wrappingKey = await deriveWrappingKey(passphrase, salt, DEFAULT_ITERATIONS);

    passphrase = '';
    const exportableMasterKey = await generateExportableMasterKey();
    const rawMasterKey = await exportMasterKey(exportableMasterKey);
    try {
      const wrapped = await encryptBytes(wrappingKey, rawMasterKey);
      // Use a non-extractable master key during the normal app session.
      const masterKey = await importMasterKey(rawMasterKey);
      return {
        masterKey,
        vaultRecord: {
          encrypted_master_key: wrapped.ciphertext,
          salt: bytesToBase64(salt),
          wrap_iv: wrapped.iv,
          kdf: 'PBKDF2-SHA256',
          kdf_iterations: DEFAULT_ITERATIONS,
          crypto_version: CRYPTO_VERSION,
        },
      };
    } finally {
      rawMasterKey.fill(0);
    }
  }

  async function unlockVault(passphrase, vaultRecord) {
    if (!vaultRecord || vaultRecord.crypto_version !== CRYPTO_VERSION) {
      throw new Error('Unsupported vault crypto version.');
    }
    if (vaultRecord.kdf !== 'PBKDF2-SHA256') {
      throw new Error('Unsupported vault KDF.');
    }

    validateIterations(vaultRecord.kdf_iterations);

    const salt = base64ToBytes(vaultRecord.salt);
    const wrappingKey = await deriveWrappingKey(
      passphrase,
      salt,
      vaultRecord.kdf_iterations
    );

    passphrase = '';
    const rawMasterKey = await decryptBytes(
      wrappingKey,
      vaultRecord.encrypted_master_key,
      vaultRecord.wrap_iv
    );

    try {
      return await importMasterKey(rawMasterKey);
    } finally {
      rawMasterKey.fill(0);
    }
  }

  async function encryptJSON(masterKey, value) {
    const plaintext = encoder.encode(JSON.stringify(value));
    try {
      const encrypted = await encryptBytes(masterKey, plaintext);
      return {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        version: CRYPTO_VERSION,
      };
    } finally {
      plaintext.fill(0);
    }
  }

  async function decryptJSON(masterKey, payload) {
    if (!payload || payload.version !== CRYPTO_VERSION) {
      throw new Error('Unsupported encrypted payload version.');
    }

    const plaintextBytes = await decryptBytes(
      masterKey,
      payload.ciphertext,
      payload.iv
    );

    try {
      return JSON.parse(decoder.decode(plaintextBytes));
    } finally {
      plaintextBytes.fill(0);
    }
  }

  return {
    createVault,
    unlockVault,
    encryptJSON,
    decryptJSON,
  };
})();

window.StackroomCrypto = StackroomCrypto;
