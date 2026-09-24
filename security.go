package main

import (
	"bytes"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

const maxRequestBytes = 2 << 20
const maxCiphertextBase64 = maxRequestBytes - 1024

// Keep the browser surface intentionally small. The app talks to Neon Auth and
// GitHub through same-origin Go endpoints, so connect-src can remain self-only.
const contentSecurityPolicy = "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'none'; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; worker-src 'none'"

var errRequestTooLarge = errors.New("request body is too large")

// Explicit public assets only. This prevents accidental exposure of .env,
// source files, SQL, tests, Git metadata, binaries, and other workspace files.
//
//go:embed index.html styles.css app.js crypto.js assets/* roadmap/index.html roadmap/styles.css roadmap/script.js
var publicAssets embed.FS

func publicHandler() http.Handler {
	files := http.FileServer(http.FS(publicAssets))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		} else if name == "roadmap" {
			name = "roadmap/index.html"
		}

		entry, err := fs.Stat(publicAssets, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if entry.IsDir() && name != "roadmap" {
			http.NotFound(w, r)
			return
		}

		// Revalidate deployable frontend files. Vault material is never stored here.
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
}

func readBoundedBody(reader io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, errors.New("unable to read request body")
	}
	if int64(len(data)) > limit {
		return nil, errRequestTooLarge
	}
	return data, nil
}

func decodeJSON(r *http.Request, target any) error {
	data, err := readBoundedBody(r.Body, maxRequestBytes)
	if err != nil {
		return err
	}

	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return errors.New("JSON body must be an object")
	}

	// First pass: reject duplicate fields and excessive nesting. encoding/json
	// otherwise accepts duplicate object keys and silently keeps the last value.
	tokens := json.NewDecoder(bytes.NewReader(data))
	if err := uniqueJSONValue(tokens, 0); err != nil {
		return errors.New("invalid JSON structure")
	}
	if _, err := tokens.Token(); err != io.EOF {
		return errors.New("unexpected data after JSON body")
	}

	// Second pass: bind into the expected struct and reject unknown fields.
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("invalid JSON body")
	}

	return nil
}

func uniqueJSONValue(decoder *json.Decoder, depth int) error {
	if depth > 32 {
		return errors.New("JSON nesting is too deep")
	}

	token, err := decoder.Token()
	if err != nil {
		return err
	}

	delim, isContainer := token.(json.Delim)
	if !isContainer {
		return nil
	}

	keys := make(map[string]struct{})
	for decoder.More() {
		if delim == '{' {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			name, ok := keyToken.(string)
			if !ok {
				return errors.New("invalid JSON object key")
			}

			canonical := strings.ToLower(name)
			if _, exists := keys[canonical]; exists {
				return errors.New("duplicate JSON field")
			}
			keys[canonical] = struct{}{}
		}

		if err := uniqueJSONValue(decoder, depth+1); err != nil {
			return err
		}
	}

	_, err = decoder.Token() // closing } or ]
	return err
}

func decodeBase64Size(value string, minBytes, maxBytes int) bool {
	if value == "" || strings.ContainsAny(value, "\r\n") {
		return false
	}
	if len(value) > base64.StdEncoding.EncodedLen(maxBytes) {
		return false
	}

	decoded, err := base64.StdEncoding.Strict().DecodeString(value)
	return err == nil && len(decoded) >= minBytes && len(decoded) <= maxBytes
}

func validateEncryptedPayload(payload *EncryptedPayload, version int) error {
	if payload == nil || payload.Version != 1 || version != 1 {
		return errors.New("a version 1 encrypted payload is required")
	}
	if !decodeBase64Size(payload.IV, 12, 12) {
		return errors.New("invalid encrypted payload IV")
	}

	// AES-GCM appends a 16-byte authentication tag. A project snapshot is always
	// non-empty JSON, so requiring at least 17 decoded bytes is reasonable.
	maxDecoded := maxCiphertextBase64 * 3 / 4
	if len(payload.Ciphertext) > maxCiphertextBase64 || !decodeBase64Size(payload.Ciphertext, 17, maxDecoded) {
		return errors.New("invalid encrypted payload ciphertext or size")
	}
	return nil
}

func validateVaultRecord(vault VaultRecord) error {
	if vault.CryptoVersion != 1 || vault.KDF != "PBKDF2-SHA256" {
		return errors.New("unsupported vault encryption parameters")
	}
	if vault.KDFIterations < 100000 || vault.KDFIterations > 5000000 {
		return errors.New("unsupported vault encryption parameters")
	}

	// Wrapped AES-256 key = 32 raw key bytes + 16-byte GCM tag.
	if !decodeBase64Size(vault.EncryptedMasterKey, 48, 48) ||
		!decodeBase64Size(vault.Salt, 16, 16) ||
		!decodeBase64Size(vault.WrapIV, 12, 12) {
		return errors.New("invalid encrypted vault metadata")
	}
	return nil
}

// Do not follow redirects while forwarding credentials or OAuth material.
var upstreamClient = &http.Client{
	Timeout: 15 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func securityHeaders(next http.Handler) http.Handler {
	publicURL, _ := url.Parse(os.Getenv("STACKROOM_PUBLIC_URL"))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()")

		requestHost, _ := url.Parse("http://" + r.Host)
		productionHTTPS := publicURL != nil && publicURL.Scheme == "https" && publicURL.Host == r.Host && !isLocalURL(publicURL)
		if requestHost != nil && !isLocalURL(requestHost) && (r.TLS != nil || productionHTTPS) {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}

		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")

			// Same-origin browser writes only. GET/HEAD remain usable for ordinary
			// navigation/fetch behavior and OAuth callbacks.
			if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
				origin := r.Header.Get("Origin")
				parsedOrigin, err := url.Parse(origin)
				crossSiteFetch := r.Header.Get("Sec-Fetch-Site") == "cross-site"
				badOrigin := origin != "" && (err != nil || parsedOrigin.Host != r.Host || (parsedOrigin.Scheme != "https" && parsedOrigin.Scheme != "http"))
				if crossSiteFetch || badOrigin {
					writeError(w, http.StatusForbidden, errors.New("cross-origin request rejected"))
					return
				}
			}

			// Bound every API request body, including proxied auth requests.
			if r.Body != nil {
				data, err := readBoundedBody(r.Body, maxRequestBytes)
				if err != nil {
					status := http.StatusBadRequest
					if errors.Is(err, errRequestTooLarge) {
						status = http.StatusRequestEntityTooLarge
					}
					writeError(w, status, err)
					return
				}
				_ = r.Body.Close()
				r.Body = io.NopCloser(bytes.NewReader(data))
			}
		}

		next.ServeHTTP(w, r)
	})
}
