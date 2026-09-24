package main

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONRejectsDuplicateFields(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/test", strings.NewReader(`{"name":"one","name":"two"}`))
	var target struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(req, &target); err == nil {
		t.Fatal("expected duplicate JSON fields to be rejected")
	}
}

func TestDecodeJSONRejectsUnknownFields(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/test", strings.NewReader(`{"name":"ok","unexpected":true}`))
	var target struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(req, &target); err == nil {
		t.Fatal("expected unknown JSON field to be rejected")
	}
}

func TestDecodeJSONRejectsOversizedBody(t *testing.T) {
	body := bytes.Repeat([]byte("a"), maxRequestBytes+1)
	req := httptest.NewRequest(http.MethodPost, "/api/test", bytes.NewReader(body))
	var target map[string]any
	if err := decodeJSON(req, &target); err == nil {
		t.Fatal("expected oversized request body to be rejected")
	}
}

func TestValidateEncryptedPayload(t *testing.T) {
	validIV := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 12))
	validCiphertext := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 48))

	payload := &EncryptedPayload{Ciphertext: validCiphertext, IV: validIV, Version: 1}
	if err := validateEncryptedPayload(payload, 1); err != nil {
		t.Fatalf("expected valid payload: %v", err)
	}

	payload.Version = 2
	if err := validateEncryptedPayload(payload, 2); err == nil {
		t.Fatal("expected unsupported payload version to be rejected")
	}
}

func TestValidateVaultRecord(t *testing.T) {
	vault := VaultRecord{
		EncryptedMasterKey: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 48)),
		Salt:               base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 16)),
		WrapIV:             base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 12)),
		KDF:                "PBKDF2-SHA256",
		KDFIterations:      600000,
		CryptoVersion:      1,
	}
	if err := validateVaultRecord(vault); err != nil {
		t.Fatalf("expected valid vault record: %v", err)
	}

	vault.WrapIV = "not-base64"
	if err := validateVaultRecord(vault); err == nil {
		t.Fatal("expected malformed vault metadata to be rejected")
	}
}

func TestSecurityHeaders(t *testing.T) {
	handler := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Security-Policy"); got == "" {
		t.Fatal("missing Content-Security-Policy")
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("unexpected X-Content-Type-Options: %q", got)
	}
	if got := rec.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Fatalf("unexpected X-Frame-Options: %q", got)
	}
	if got := rec.Header().Get("Strict-Transport-Security"); got != "" {
		t.Fatalf("localhost must not receive HSTS, got %q", got)
	}
}

func TestSecurityHeadersRejectCrossOriginWrite(t *testing.T) {
	handler := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodPost, "http://localhost:8080/api/projects", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}

func TestPublicHandlerDoesNotExposeWorkspaceFiles(t *testing.T) {
	handler := publicHandler()

	for _, path := range []string{"/main.go", "/security.go", "/schema.sql", "/.env", "/.git/config", "/tests/vault_browser_test.py"} {
		req := httptest.NewRequest(http.MethodGet, "http://localhost:8080"+path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s must not be public; got status %d", path, rec.Code)
		}
	}
}

func TestCSPDoesNotAllowInlineScriptOrEval(t *testing.T) {
	if strings.Contains(contentSecurityPolicy, "'unsafe-inline'") {
		t.Fatal("CSP must not allow unsafe-inline")
	}
	if strings.Contains(contentSecurityPolicy, "'unsafe-eval'") {
		t.Fatal("CSP must not allow unsafe-eval")
	}
	if !strings.Contains(contentSecurityPolicy, "script-src 'self'") || !strings.Contains(contentSecurityPolicy, "frame-ancestors 'none'") {
		t.Fatal("CSP is missing core script/frame restrictions")
	}
}

func TestSecurityHeadersRejectOversizedAPIRequest(t *testing.T) {
	handler := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodPost, "http://localhost:8080/api/projects", bytes.NewReader(bytes.Repeat([]byte("x"), maxRequestBytes+1)))
	req.Header.Set("Origin", "http://localhost:8080")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", rec.Code)
	}
}
