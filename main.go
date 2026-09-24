package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

type Activity struct {
	ID        string `json:"id,omitempty"`
	Action    string `json:"action"`
	Detail    string `json:"detail"`
	CreatedAt string `json:"createdAt"`
}

type EncryptedPayload struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Version    int    `json:"version"`
}

type Project struct {
	Legacy            *LegacyProjectFields `json:"legacy,omitempty"`
	MigrationRevision string               `json:"migrationRevision,omitempty"`
	ID                string               `json:"id"`
	Name              string               `json:"name"`
	Slug              string               `json:"slug"`
	Description       string               `json:"description"`
	Status            string               `json:"status"`
	Category          string               `json:"category"`
	Priority          string               `json:"priority"`
	Technologies      []Technology         `json:"technologies"`
	Domains           []Domain             `json:"domains"`
	Deployments       []Deployment         `json:"deployments"`
	Databases         []ProjectDB          `json:"databases"`
	Links             []ProjectLink        `json:"links"`
	Notes             string               `json:"notes"`
	Activities        []Activity           `json:"activities"`
	GitHub            *GitHubRepository    `json:"github,omitempty"`
	EncryptedPayload  *EncryptedPayload    `json:"encryptedPayload,omitempty"`
	EncryptionVersion int                  `json:"encryptionVersion,omitempty"`
	IsEncrypted       bool                 `json:"isEncrypted"`
	CreatedAt         string               `json:"createdAt"`
	UpdatedAt         string               `json:"updatedAt"`
}

// Legacy fields are included in the encrypted snapshot even when richer child records exist.
type LegacyProjectFields struct {
	Stack       string `json:"stack"`
	Domain      string `json:"domain"`
	DeployedURL string `json:"deployedUrl"`
}

type VaultRecord struct {
	EncryptedMasterKey string `json:"encrypted_master_key"`
	Salt               string `json:"salt"`
	WrapIV             string `json:"wrap_iv"`
	KDF                string `json:"kdf"`
	KDFIterations      int    `json:"kdf_iterations"`
	CryptoVersion      int    `json:"crypto_version"`
}

type Technology struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type Domain struct {
	ID          string `json:"id,omitempty"`
	Hostname    string `json:"hostname"`
	Registrar   string `json:"registrar"`
	DNSProvider string `json:"dnsProvider"`
	ExpiresAt   string `json:"expiresAt"`
	AutoRenew   bool   `json:"autoRenew"`
	Notes       string `json:"notes"`
}

type Deployment struct {
	ID          string `json:"id,omitempty"`
	Name        string `json:"name"`
	Provider    string `json:"provider"`
	Environment string `json:"environment"`
	URL         string `json:"url"`
	Repository  string `json:"repository"`
	Branch      string `json:"branch"`
	Status      string `json:"status"`
	Notes       string `json:"notes"`
}

type ProjectDB struct {
	ID           string `json:"id,omitempty"`
	Name         string `json:"name"`
	Provider     string `json:"provider"`
	DatabaseType string `json:"databaseType"`
	Environment  string `json:"environment"`
	URL          string `json:"url"`
	Notes        string `json:"notes"`
}

type ProjectLink struct {
	ID    string `json:"id,omitempty"`
	Label string `json:"label"`
	URL   string `json:"url"`
	Kind  string `json:"kind"`
}

type GitHubRepository struct {
	ID                string `json:"id"`
	GitHubRepoID      int64  `json:"githubRepoId"`
	Owner             string `json:"owner"`
	Name              string `json:"name"`
	FullName          string `json:"fullName"`
	HTMLURL           string `json:"htmlUrl"`
	DefaultBranch     string `json:"defaultBranch"`
	Private           bool   `json:"private"`
	Description       string `json:"description"`
	UpdatedAt         string `json:"updatedAt"`
	LinkedProjectID   string `json:"linkedProjectId,omitempty"`
	LinkedProjectName string `json:"linkedProjectName,omitempty"`
}

type GitHubConnection struct {
	ID           string `json:"id"`
	Login        string `json:"login"`
	AvatarURL    string `json:"avatarUrl"`
	GitHubUserID int64  `json:"githubUserId"`
	ConnectedAt  string `json:"connectedAt"`
}

type githubTokenResponse struct {
	AccessToken           string `json:"access_token"`
	TokenType             string `json:"token_type"`
	ExpiresIn             int    `json:"expires_in"`
	RefreshToken          string `json:"refresh_token"`
	RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"`
}

type githubUserResponse struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
}

type githubRepoResponse struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	FullName      string `json:"full_name"`
	HTMLURL       string `json:"html_url"`
	DefaultBranch string `json:"default_branch"`
	Private       bool   `json:"private"`
	Description   string `json:"description"`
	UpdatedAt     string `json:"updated_at"`
	Owner         struct {
		Login string `json:"login"`
	} `json:"owner"`
}

type projectStore struct {
	pool               *pgxpool.Pool
	authBaseURL        string
	memory             map[string]Project
	memoryMu           sync.RWMutex
	githubClientID     string
	githubClientSecret string
	githubRedirectURI  string
	githubPublicURL    string
	githubTokenKey     []byte
}

func main() {
	_ = godotenv.Load()

	store := &projectStore{memory: make(map[string]Project)}
	store.authBaseURL = strings.TrimRight(os.Getenv("NEON_AUTH_BASE_URL"), "/")
	store.githubClientID = strings.TrimSpace(os.Getenv("GITHUB_APP_CLIENT_ID"))
	store.githubClientSecret = strings.TrimSpace(os.Getenv("GITHUB_APP_CLIENT_SECRET"))
	store.githubRedirectURI = strings.TrimSpace(os.Getenv("GITHUB_REDIRECT_URI"))
	store.githubPublicURL = strings.TrimRight(strings.TrimSpace(os.Getenv("STACKROOM_PUBLIC_URL")), "/")
	store.githubTokenKey = parseEncryptionKey(os.Getenv("GITHUB_TOKEN_ENCRYPTION_KEY"))

	if connectionString := os.Getenv("DATABASE_URL"); connectionString != "" {
		poolConfig, err := pgxpool.ParseConfig(connectionString)
		if err != nil {
			log.Fatalf("parse Neon connection config: %v", err)
		}

		// Neon pooled connections use PgBouncer. Avoid pgx named prepared
		// statement caching so the app remains compatible with transaction pooling.
		poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec

		pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
		if err != nil {
			log.Fatalf("create Neon pool: %v", err)
		}
		if err := pool.Ping(context.Background()); err != nil {
			pool.Close()
			log.Fatalf("connect to Neon: %v", err)
		}
		store.pool = pool
		defer pool.Close()
		log.Println("connected to Neon")
	} else {
		log.Println("DATABASE_URL is empty; using in-memory preview storage")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/", store.authHandler)
	mux.HandleFunc("/api/vault", store.vaultHandler)
	mux.HandleFunc("/api/projects", store.projectsHandler)
	mux.HandleFunc("/api/projects/", store.projectHandler)
	mux.HandleFunc("/api/integrations/github/connect", store.githubConnectHandler)
	mux.HandleFunc("/api/integrations/github/callback", store.githubCallbackHandler)
	mux.HandleFunc("/api/integrations/github/status", store.githubStatusHandler)
	mux.HandleFunc("/api/integrations/github/disconnect", store.githubDisconnectHandler)
	mux.HandleFunc("/api/github/repositories", store.githubRepositoriesHandler)
	mux.Handle("/", publicHandler())

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           securityHeaders(loggingMiddleware(mux)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("Stackroom running at http://localhost:%s", port)
	log.Fatal(server.ListenAndServe())
}

func (store *projectStore) vaultHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/vault" {
		http.NotFound(w, r)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}

	userID, authenticated, err := store.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !authenticated {
		writeError(w, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	if store.pool == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("database is required for vault storage"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		var vault VaultRecord
		err := store.pool.QueryRow(r.Context(), `
			select encrypted_master_key, salt, wrap_iv, kdf, kdf_iterations, crypto_version
			from user_vaults
			where owner_id = $1`, userID).Scan(
			&vault.EncryptedMasterKey,
			&vault.Salt,
			&vault.WrapIV,
			&vault.KDF,
			&vault.KDFIterations,
			&vault.CryptoVersion,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusOK, map[string]any{"exists": false})
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"exists": true,
			"vault":  vault,
		})

	case http.MethodPost:
		var vault VaultRecord
		if err := decodeJSON(r, &vault); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		vault.EncryptedMasterKey = strings.TrimSpace(vault.EncryptedMasterKey)
		vault.Salt = strings.TrimSpace(vault.Salt)
		vault.WrapIV = strings.TrimSpace(vault.WrapIV)
		vault.KDF = strings.TrimSpace(vault.KDF)

		if vault.EncryptedMasterKey == "" || vault.Salt == "" || vault.WrapIV == "" {
			writeError(w, http.StatusBadRequest, errors.New("invalid vault record"))
			return
		}
		if vault.KDF == "" {
			vault.KDF = "PBKDF2-SHA256"
		}
		if vault.KDF != "PBKDF2-SHA256" {
			writeError(w, http.StatusBadRequest, errors.New("unsupported vault KDF"))
			return
		}
		if vault.KDFIterations <= 0 {
			vault.KDFIterations = 600000
		}
		if vault.KDFIterations < 100000 || vault.KDFIterations > 5000000 {
			writeError(w, http.StatusBadRequest, errors.New("unsupported PBKDF2 iteration count"))
			return
		}
		if vault.CryptoVersion <= 0 {
			vault.CryptoVersion = 1
		}
		if vault.CryptoVersion != 1 {
			writeError(w, http.StatusBadRequest, errors.New("unsupported vault crypto version"))
			return
		}
		if err := validateVaultRecord(vault); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		result, err := store.pool.Exec(r.Context(), `
			insert into user_vaults (
				owner_id, encrypted_master_key, salt, wrap_iv,
				kdf, kdf_iterations, crypto_version, updated_at
			)
			values ($1,$2,$3,$4,$5,$6,$7,now())
			on conflict (owner_id) do nothing`,
			userID,
			vault.EncryptedMasterKey,
			vault.Salt,
			vault.WrapIV,
			vault.KDF,
			vault.KDFIterations,
			vault.CryptoVersion,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		if result.RowsAffected() == 0 {
			writeError(w, http.StatusConflict, errors.New("a private vault already exists; unlock it instead"))
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{"saved": true})
	}
}

func (store *projectStore) projectsHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/projects" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}

	userID, authenticated, err := store.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !authenticated {
		writeError(w, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		projects, err := store.listProjects(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, projects)

	case http.MethodPost:
		var project Project
		if err := decodeJSON(r, &project); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if project.IsEncrypted || project.EncryptedPayload != nil {
			if err := validateEncryptedProject(project); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			created, err := store.createEncryptedProject(r.Context(), project, userID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusCreated, created)
			return
		}

		normalizeProject(&project)
		if err := validateProject(project); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		created, err := store.createProject(r.Context(), project, userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusCreated, created)
	}
}

func (store *projectStore) projectHandler(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/migrate") {
		store.projectMigrationHandler(w, r)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/github") {
		store.projectGitHubHandler(w, r)
		return
	}
	rawID := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	if rawID == "" || strings.Contains(rawID, "/") {
		http.NotFound(w, r)
		return
	}

	userID, authenticated, err := store.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !authenticated {
		writeError(w, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		project, err := store.getProject(r.Context(), rawID, userID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, http.StatusNotFound, errors.New("project not found"))
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, project)

	case http.MethodPatch:
		var project Project
		if err := decodeJSON(r, &project); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		project.ID = rawID

		var updated Project
		if project.IsEncrypted || project.EncryptedPayload != nil {
			if err := validateEncryptedProject(project); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			updated, err = store.updateEncryptedProject(r.Context(), project, userID)
		} else {
			normalizeProject(&project)
			if err := validateProject(project); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			updated, err = store.updateProject(r.Context(), project, userID)
		}

		if err != nil {
			if errors.Is(err, errMigrationRequired) || errors.Is(err, errProjectEncrypted) {
				writeError(w, http.StatusConflict, err)
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, http.StatusNotFound, errors.New("project not found"))
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, updated)

	case http.MethodDelete:
		if err := store.deleteProject(r.Context(), rawID, userID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, http.StatusNotFound, errors.New("project not found"))
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		w.Header().Set("Allow", "GET, PATCH, DELETE")
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

func (store *projectStore) listProjects(ctx context.Context, userID string) ([]Project, error) {
	if store.pool == nil {
		store.memoryMu.RLock()
		defer store.memoryMu.RUnlock()
		projects := make([]Project, 0, len(store.memory))
		for _, project := range store.memory {
			projects = append(projects, project)
		}
		sortProjects(projects)
		return projects, nil
	}

	rows, err := store.pool.Query(ctx, `
		select id, name, coalesce(slug, ''), coalesce(description, ''), status,
		       coalesce(category, ''), coalesce(priority, 'normal'), coalesce(notes, ''),
		       created_at, updated_at, coalesce(encrypted_payload, ''),
		       coalesce(encryption_version, 0), coalesce(is_encrypted, false)
		from projects
		where owner_id = $1
		order by updated_at desc, created_at desc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var project Project
		var createdAt, updatedAt time.Time
		var encryptedRaw string
		if err := rows.Scan(
			&project.ID,
			&project.Name,
			&project.Slug,
			&project.Description,
			&project.Status,
			&project.Category,
			&project.Priority,
			&project.Notes,
			&createdAt,
			&updatedAt,
			&encryptedRaw,
			&project.EncryptionVersion,
			&project.IsEncrypted,
		); err != nil {
			return nil, err
		}

		project.CreatedAt = createdAt.Format(time.RFC3339)
		project.UpdatedAt = updatedAt.Format(time.RFC3339)

		if project.IsEncrypted {
			if encryptedRaw == "" {
				return nil, errors.New("encrypted project is missing its payload")
			}
			var payload EncryptedPayload
			if err := json.Unmarshal([]byte(encryptedRaw), &payload); err != nil {
				return nil, fmt.Errorf("decode encrypted project payload: %w", err)
			}
			project.EncryptedPayload = &payload

			// Never return the database placeholders as user project content.
			project.Name = ""
			project.Slug = ""
			project.Description = ""
			project.Status = ""
			project.Category = ""
			project.Priority = ""
			project.Notes = ""

			if err := store.loadProjectGitHub(ctx, &project); err != nil {
				return nil, err
			}
			projects = append(projects, project)
			continue
		}

		if err := store.loadProjectChildren(ctx, &project); err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (store *projectStore) getProject(ctx context.Context, id, userID string) (Project, error) {
	if store.pool == nil {
		store.memoryMu.RLock()
		defer store.memoryMu.RUnlock()
		project, ok := store.memory[id]
		if !ok {
			return Project{}, pgx.ErrNoRows
		}
		return project, nil
	}

	return getProjectFrom(ctx, store.pool, id, userID)
}

// Both pool reads and migration transactions use the same complete source representation.
type projectReader interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func getProjectFrom(ctx context.Context, reader projectReader, id, userID string) (Project, error) {

	var project Project
	var createdAt, updatedAt time.Time
	var encryptedRaw string
	var legacy LegacyProjectFields
	err := reader.QueryRow(ctx, `
		select id, name, coalesce(slug, ''), coalesce(description, ''), status,
		       coalesce(category, ''), coalesce(priority, 'normal'), coalesce(notes, ''),
		       created_at, updated_at, coalesce(encrypted_payload, ''),
		       coalesce(encryption_version, 0), coalesce(is_encrypted, false),
		       coalesce(stack, ''), coalesce(domain, ''), coalesce(deployed_url, '')
		from projects
		where id = $1 and owner_id = $2`, id, userID).
		Scan(
			&project.ID,
			&project.Name,
			&project.Slug,
			&project.Description,
			&project.Status,
			&project.Category,
			&project.Priority,
			&project.Notes,
			&createdAt,
			&updatedAt,
			&encryptedRaw,
			&project.EncryptionVersion,
			&project.IsEncrypted,
			&legacy.Stack, &legacy.Domain, &legacy.DeployedURL,
		)
	if err != nil {
		return Project{}, err
	}

	project.CreatedAt = createdAt.Format(time.RFC3339Nano)
	project.UpdatedAt = updatedAt.Format(time.RFC3339Nano)

	if project.IsEncrypted {
		if encryptedRaw == "" {
			return Project{}, errors.New("encrypted project is missing its payload")
		}
		var payload EncryptedPayload
		if err := json.Unmarshal([]byte(encryptedRaw), &payload); err != nil {
			return Project{}, fmt.Errorf("decode encrypted project payload: %w", err)
		}
		project.EncryptedPayload = &payload
		project.Name = ""
		project.Slug = ""
		project.Description = ""
		project.Status = ""
		project.Category = ""
		project.Priority = ""
		project.Notes = ""
		if err := loadProjectGitHubFrom(ctx, reader, &project); err != nil {
			return Project{}, err
		}
		return project, nil
	}

	if err := loadProjectChildrenFrom(ctx, reader, &project); err != nil {
		return Project{}, err
	}
	project.Legacy = &legacy
	return project, nil
}

func validateEncryptedProject(project Project) error {
	if project.EncryptedPayload == nil {
		return errors.New("encryptedPayload is required")
	}

	version := project.EncryptionVersion
	if version <= 0 {
		version = project.EncryptedPayload.Version
	}

	return validateEncryptedPayload(project.EncryptedPayload, version)
}

func encryptedPayloadJSON(payload *EncryptedPayload) (string, error) {
	if payload == nil {
		return "", errors.New("encryptedPayload is required")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func (store *projectStore) createEncryptedProject(ctx context.Context, project Project, userID string) (Project, error) {
	now := time.Now()
	project.ID = newPreviewID()
	project.IsEncrypted = true
	if project.EncryptionVersion <= 0 && project.EncryptedPayload != nil {
		project.EncryptionVersion = project.EncryptedPayload.Version
	}
	project.CreatedAt = now.Format(time.RFC3339)
	project.UpdatedAt = project.CreatedAt

	if store.pool == nil {
		store.memoryMu.Lock()
		defer store.memoryMu.Unlock()
		store.memory[project.ID] = cloneProject(project)
		return project, nil
	}

	encryptedJSON, err := encryptedPayloadJSON(project.EncryptedPayload)
	if err != nil {
		return Project{}, err
	}

	var createdAt, updatedAt time.Time
	err = store.pool.QueryRow(ctx, `
		insert into projects (
			owner_id, name, slug, description, status, category, priority, notes,
			encrypted_payload, encryption_version, is_encrypted
		)
		values ($1, '[encrypted]', null, null, 'active', null, 'normal', null, $2, $3, true)
		returning id, created_at, updated_at`,
		userID, encryptedJSON, project.EncryptionVersion,
	).Scan(&project.ID, &createdAt, &updatedAt)
	if err != nil {
		return Project{}, err
	}

	project.Name = ""
	project.Slug = ""
	project.Description = ""
	project.Status = ""
	project.Category = ""
	project.Priority = ""
	project.Notes = ""
	project.CreatedAt = createdAt.Format(time.RFC3339)
	project.UpdatedAt = updatedAt.Format(time.RFC3339)
	return project, nil
}

func (store *projectStore) updateEncryptedProject(ctx context.Context, project Project, userID string) (Project, error) {
	project.IsEncrypted = true
	if project.EncryptionVersion <= 0 && project.EncryptedPayload != nil {
		project.EncryptionVersion = project.EncryptedPayload.Version
	}

	if store.pool == nil {
		store.memoryMu.Lock()
		defer store.memoryMu.Unlock()
		existing, ok := store.memory[project.ID]
		if !ok {
			return Project{}, pgx.ErrNoRows
		}
		if !existing.IsEncrypted {
			return Project{}, errMigrationRequired
		}
		project.CreatedAt = existing.CreatedAt
		project.UpdatedAt = time.Now().Format(time.RFC3339)
		project.GitHub = existing.GitHub
		store.memory[project.ID] = cloneProject(project)
		return project, nil
	}

	encryptedJSON, err := encryptedPayloadJSON(project.EncryptedPayload)
	if err != nil {
		return Project{}, err
	}

	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback(ctx)
	var alreadyEncrypted bool
	if err := tx.QueryRow(ctx, `select coalesce(is_encrypted,false) from projects where id=$1 and owner_id=$2 for update`, project.ID, userID).Scan(&alreadyEncrypted); err != nil {
		return Project{}, err
	}
	if !alreadyEncrypted {
		return Project{}, errMigrationRequired
	}

	var createdAt, updatedAt time.Time
	err = tx.QueryRow(ctx, `
		update projects
		set name='[encrypted]',
		    slug=null,
		    description=null,
		    status='active',
		    category=null,
		    priority='normal',
		    stack=null,
		    domain=null,
		    deployed_url=null,
		    notes=null,
		    encrypted_payload=$2,
		    encryption_version=$3,
		    is_encrypted=true,
		    updated_at=now()
		where id=$1 and owner_id=$4
		returning created_at, updated_at`,
		project.ID, encryptedJSON, project.EncryptionVersion, userID,
	).Scan(&createdAt, &updatedAt)
	if err != nil {
		return Project{}, err
	}

	// Remove any legacy plaintext children when a project is migrated to E2EE.
	for _, table := range []string{
		"project_technologies",
		"project_domains",
		"project_deployments",
		"project_databases",
		"project_links",
		"project_activity",
	} {
		if _, err := tx.Exec(ctx, `delete from `+table+` where project_id=$1`, project.ID); err != nil {
			return Project{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Project{}, err
	}

	project.Name = ""
	project.Slug = ""
	project.Description = ""
	project.Status = ""
	project.Category = ""
	project.Priority = ""
	project.Notes = ""
	project.CreatedAt = createdAt.Format(time.RFC3339)
	project.UpdatedAt = updatedAt.Format(time.RFC3339)
	if err := store.loadProjectGitHub(ctx, &project); err != nil {
		return Project{}, err
	}
	return project, nil
}

func (store *projectStore) createProject(ctx context.Context, project Project, userID string) (Project, error) {
	now := time.Now()
	project.ID = newPreviewID()
	project.CreatedAt = now.Format(time.RFC3339)
	project.UpdatedAt = project.CreatedAt

	if store.pool == nil {
		store.memoryMu.Lock()
		defer store.memoryMu.Unlock()
		project.Activities = []Activity{{Action: "created", Detail: "Project created.", CreatedAt: project.CreatedAt}}
		store.memory[project.ID] = cloneProject(project)
		return project, nil
	}

	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback(ctx)

	var createdAt, updatedAt time.Time
	err = tx.QueryRow(ctx, `
        insert into projects (owner_id, name, slug, description, status, category, priority, notes)
        values ($1,$2,$3,$4,$5,$6,$7,$8)
        returning id, created_at, updated_at`, userID, project.Name, project.Slug, nullIfEmpty(project.Description), project.Status, nullIfEmpty(project.Category), project.Priority, nullIfEmpty(project.Notes)).
		Scan(&project.ID, &createdAt, &updatedAt)
	if err != nil {
		return Project{}, err
	}
	if err := replaceChildren(ctx, tx, project); err != nil {
		return Project{}, err
	}
	if _, err := tx.Exec(ctx, `insert into project_activity(project_id, action, detail) values($1,$2,$3)`, project.ID, "created", "Project created."); err != nil {
		return Project{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Project{}, err
	}
	project.CreatedAt = createdAt.Format(time.RFC3339)
	project.UpdatedAt = updatedAt.Format(time.RFC3339)
	if err := store.loadProjectChildren(ctx, &project); err != nil {
		return Project{}, err
	}
	return project, nil
}

func (store *projectStore) updateProject(ctx context.Context, project Project, userID string) (Project, error) {
	if store.pool == nil {
		store.memoryMu.Lock()
		defer store.memoryMu.Unlock()
		existing, ok := store.memory[project.ID]
		if !ok {
			return Project{}, pgx.ErrNoRows
		}
		if existing.IsEncrypted {
			return Project{}, errProjectEncrypted
		}
		project.CreatedAt = existing.CreatedAt
		project.UpdatedAt = time.Now().Format(time.RFC3339)
		project.Activities = append([]Activity(nil), existing.Activities...)
		project.Activities = append([]Activity{{Action: "updated", Detail: "Project details updated.", CreatedAt: project.UpdatedAt}}, project.Activities...)
		store.memory[project.ID] = cloneProject(project)
		return project, nil
	}

	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback(ctx)
	var alreadyEncrypted bool
	if err := tx.QueryRow(ctx, `select coalesce(is_encrypted,false) from projects where id=$1 and owner_id=$2 for update`, project.ID, userID).Scan(&alreadyEncrypted); err != nil {
		return Project{}, err
	}
	if alreadyEncrypted {
		return Project{}, errProjectEncrypted
	}

	var createdAt, updatedAt time.Time
	err = tx.QueryRow(ctx, `
        update projects
        set name=$2, slug=$3, description=$4, status=$5, category=$6, priority=$7, notes=$8, updated_at=now()
        where id=$1 and owner_id=$9
        returning created_at, updated_at`, project.ID, project.Name, project.Slug, nullIfEmpty(project.Description), project.Status, nullIfEmpty(project.Category), project.Priority, nullIfEmpty(project.Notes), userID).
		Scan(&createdAt, &updatedAt)
	if err != nil {
		return Project{}, err
	}
	if err := replaceChildren(ctx, tx, project); err != nil {
		return Project{}, err
	}
	if _, err := tx.Exec(ctx, `insert into project_activity(project_id, action, detail) values($1,$2,$3)`, project.ID, "updated", "Project details updated."); err != nil {
		return Project{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Project{}, err
	}
	project.CreatedAt = createdAt.Format(time.RFC3339)
	project.UpdatedAt = updatedAt.Format(time.RFC3339)
	if err := store.loadProjectChildren(ctx, &project); err != nil {
		return Project{}, err
	}
	return project, nil
}

func (store *projectStore) deleteProject(ctx context.Context, id, userID string) error {
	if store.pool == nil {
		store.memoryMu.Lock()
		defer store.memoryMu.Unlock()
		if _, ok := store.memory[id]; !ok {
			return pgx.ErrNoRows
		}
		delete(store.memory, id)
		return nil
	}
	result, err := store.pool.Exec(ctx, `delete from projects where id=$1 and owner_id=$2`, id, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (store *projectStore) loadProjectChildren(ctx context.Context, project *Project) error {
	return loadProjectChildrenFrom(ctx, store.pool, project)
}

func loadProjectChildrenFrom(ctx context.Context, reader projectReader, project *Project) error {
	project.Activities = nil
	project.Technologies = nil
	project.Domains = nil
	project.Deployments = nil
	project.Databases = nil
	project.Links = nil

	rows, err := reader.Query(ctx, `select id, name, kind from project_technologies where project_id=$1 order by created_at, id`, project.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var item Technology
		if err := rows.Scan(&item.ID, &item.Name, &item.Kind); err != nil {
			rows.Close()
			return err
		}
		project.Technologies = append(project.Technologies, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	rows, err = reader.Query(ctx, `select id, hostname, coalesce(registrar,''), coalesce(dns_provider,''), coalesce(expires_at::text,''), auto_renew, coalesce(notes,'') from project_domains where project_id=$1 order by created_at, id`, project.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var item Domain
		if err := rows.Scan(&item.ID, &item.Hostname, &item.Registrar, &item.DNSProvider, &item.ExpiresAt, &item.AutoRenew, &item.Notes); err != nil {
			rows.Close()
			return err
		}
		project.Domains = append(project.Domains, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	rows, err = reader.Query(ctx, `select id, name, coalesce(provider,''), environment, coalesce(url,''), coalesce(repository,''), coalesce(branch,''), status, coalesce(notes,'') from project_deployments where project_id=$1 order by created_at, id`, project.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var item Deployment
		if err := rows.Scan(&item.ID, &item.Name, &item.Provider, &item.Environment, &item.URL, &item.Repository, &item.Branch, &item.Status, &item.Notes); err != nil {
			rows.Close()
			return err
		}
		project.Deployments = append(project.Deployments, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	rows, err = reader.Query(ctx, `select id, name, coalesce(provider,''), coalesce(database_type,''), environment, coalesce(url,''), coalesce(notes,'') from project_databases where project_id=$1 order by created_at, id`, project.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var item ProjectDB
		if err := rows.Scan(&item.ID, &item.Name, &item.Provider, &item.DatabaseType, &item.Environment, &item.URL, &item.Notes); err != nil {
			rows.Close()
			return err
		}
		project.Databases = append(project.Databases, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	rows, err = reader.Query(ctx, `select id, label, url, kind from project_links where project_id=$1 order by created_at, id`, project.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var item ProjectLink
		if err := rows.Scan(&item.ID, &item.Label, &item.URL, &item.Kind); err != nil {
			rows.Close()
			return err
		}
		project.Links = append(project.Links, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	rows, err = reader.Query(ctx, `select id, action, coalesce(detail,''), created_at::text from project_activity where project_id=$1 order by created_at desc, id`, project.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var item Activity
		if err := rows.Scan(&item.ID, &item.Action, &item.Detail, &item.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		project.Activities = append(project.Activities, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if err := loadProjectGitHubFrom(ctx, reader, project); err != nil {
		return err
	}
	return rows.Err()
}

func replaceChildren(ctx context.Context, tx pgx.Tx, project Project) error {
	tables := []string{"project_technologies", "project_domains", "project_deployments", "project_databases", "project_links"}
	for _, table := range tables {
		if _, err := tx.Exec(ctx, `delete from `+table+` where project_id=$1`, project.ID); err != nil {
			return err
		}
	}

	for _, item := range project.Technologies {
		if strings.TrimSpace(item.Name) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `insert into project_technologies(project_id,name,kind) values($1,$2,$3)`, project.ID, strings.TrimSpace(item.Name), defaultKind(item.Kind, "other")); err != nil {
			return err
		}
	}
	for _, item := range project.Domains {
		if strings.TrimSpace(item.Hostname) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `insert into project_domains(project_id,hostname,registrar,dns_provider,expires_at,auto_renew,notes) values($1,$2,$3,$4,nullif($5,'')::date,$6,$7)`, project.ID, strings.TrimSpace(item.Hostname), nullIfEmpty(item.Registrar), nullIfEmpty(item.DNSProvider), item.ExpiresAt, item.AutoRenew, nullIfEmpty(item.Notes)); err != nil {
			return err
		}
	}
	for _, item := range project.Deployments {
		if strings.TrimSpace(item.Name) == "" && strings.TrimSpace(item.URL) == "" {
			continue
		}
		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = "Deployment"
		}
		status := defaultKind(item.Status, "active")
		if status != "active" && status != "paused" && status != "unknown" {
			status = "unknown"
		}
		if _, err := tx.Exec(ctx, `insert into project_deployments(project_id,name,provider,environment,url,repository,branch,status,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, project.ID, name, nullIfEmpty(item.Provider), defaultKind(item.Environment, "production"), nullIfEmpty(item.URL), nullIfEmpty(item.Repository), nullIfEmpty(item.Branch), status, nullIfEmpty(item.Notes)); err != nil {
			return err
		}
	}
	for _, item := range project.Databases {
		if strings.TrimSpace(item.Name) == "" && strings.TrimSpace(item.Provider) == "" && strings.TrimSpace(item.DatabaseType) == "" {
			continue
		}
		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = "Primary database"
		}
		if _, err := tx.Exec(ctx, `insert into project_databases(project_id,name,provider,database_type,environment,url,notes) values($1,$2,$3,$4,$5,$6,$7)`, project.ID, name, nullIfEmpty(item.Provider), nullIfEmpty(item.DatabaseType), defaultKind(item.Environment, "production"), nullIfEmpty(item.URL), nullIfEmpty(item.Notes)); err != nil {
			return err
		}
	}
	for _, item := range project.Links {
		if strings.TrimSpace(item.Label) == "" || strings.TrimSpace(item.URL) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `insert into project_links(project_id,label,url,kind) values($1,$2,$3,$4)`, project.ID, strings.TrimSpace(item.Label), strings.TrimSpace(item.URL), defaultKind(item.Kind, "other")); err != nil {
			return err
		}
	}
	return nil
}

func (store *projectStore) authHandler(w http.ResponseWriter, r *http.Request) {
	if store.authBaseURL == "" {
		if strings.TrimPrefix(r.URL.Path, "/api/auth/") == "get-session" {
			writeJSON(w, http.StatusOK, map[string]any{"session": map[string]string{"id": "local-preview"}, "user": map[string]string{"id": "local-preview", "name": "Local preview", "email": "local@example.com"}})
			return
		}
		writeError(w, http.StatusServiceUnavailable, errors.New("NEON_AUTH_BASE_URL is not configured"))
		return
	}

	suffix := strings.TrimPrefix(r.URL.Path, "/api/auth/")
	target := strings.TrimRight(store.authBaseURL, "/") + "/" + suffix
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}

	parsed, err := url.Parse(target)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if parsed.Scheme != "https" && !isLocalURL(parsed) {
		writeError(w, http.StatusBadGateway, errors.New("auth endpoint must use HTTPS"))
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, parsed.String(), r.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	for key, values := range r.Header {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}

	response, err := upstreamClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	defer response.Body.Close()
	copyResponseHeaders(w, response.Header)
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func (store *projectStore) userFromRequest(r *http.Request) (string, bool, error) {
	if store.authBaseURL == "" {
		return "local-preview", true, nil
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, store.authBaseURL+"/get-session", nil)
	if err != nil {
		return "", false, err
	}
	request.Header.Set("Cookie", r.Header.Get("Cookie"))
	response, err := upstreamClient.Do(request)
	if err != nil {
		return "", false, err
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusInternalServerError {
		return "", false, fmt.Errorf("Neon Auth returned status %d", response.StatusCode)
	}

	var payload struct {
		User *struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", false, err
	}
	if payload.User == nil || payload.User.ID == "" {
		return "", false, nil
	}
	return payload.User.ID, true, nil
}

func (store *projectStore) githubConfigured() bool {
	return store.githubClientID != "" && store.githubClientSecret != "" && store.githubRedirectURI != "" && len(store.githubTokenKey) == 32 && store.pool != nil
}

func (store *projectStore) githubConnectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}
	if !store.githubConfigured() {
		writeError(w, http.StatusServiceUnavailable, errors.New("GitHub integration is not configured"))
		return
	}
	userID, authenticated, err := store.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !authenticated {
		writeError(w, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}

	stateBytes := make([]byte, 32)
	if _, err := rand.Read(stateBytes); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	state := base64.RawURLEncoding.EncodeToString(stateBytes)
	hash := sha256.Sum256([]byte(state))
	_, _ = store.pool.Exec(r.Context(), `delete from github_oauth_states where expires_at < now()`)
	if _, err := store.pool.Exec(r.Context(), `insert into github_oauth_states(state_hash,user_id,expires_at) values($1,$2,now()+interval '10 minutes')`, hex.EncodeToString(hash[:]), userID); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	authURL, err := url.Parse("https://github.com/login/oauth/authorize")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	q := authURL.Query()
	q.Set("client_id", store.githubClientID)
	q.Set("redirect_uri", store.githubRedirectURI)
	q.Set("state", state)
	authURL.RawQuery = q.Encode()
	http.Redirect(w, r, authURL.String(), http.StatusFound)
}

func (store *projectStore) githubCallbackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}
	if !store.githubConfigured() {
		http.Redirect(w, r, "/?github=error&reason=not_configured", http.StatusFound)
		return
	}
	if oauthErr := r.URL.Query().Get("error"); oauthErr != "" {
		http.Redirect(w, r, "/?github=error&reason="+url.QueryEscape(oauthErr), http.StatusFound)
		return
	}
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" || state == "" {
		http.Redirect(w, r, "/?github=error&reason=missing_parameters", http.StatusFound)
		return
	}
	userID, authenticated, err := store.userFromRequest(r)
	if err != nil {
		http.Redirect(w, r, "/?github=error&reason=session_check", http.StatusFound)
		return
	}
	if !authenticated {
		http.Redirect(w, r, "/?github=error&reason=authentication_required", http.StatusFound)
		return
	}
	hash := sha256.Sum256([]byte(state))
	var ownerID string
	var expiresAt time.Time
	err = store.pool.QueryRow(r.Context(), `select user_id, expires_at from github_oauth_states where state_hash=$1`, hex.EncodeToString(hash[:])).Scan(&ownerID, &expiresAt)
	if err != nil || ownerID != userID || time.Now().After(expiresAt) {
		http.Redirect(w, r, "/?github=error&reason=invalid_state", http.StatusFound)
		return
	}
	_, _ = store.pool.Exec(r.Context(), `delete from github_oauth_states where state_hash=$1`, hex.EncodeToString(hash[:]))

	token, err := store.exchangeGitHubCode(r.Context(), code)
	if err != nil {
		log.Printf("github token exchange: %v", err)
		http.Redirect(w, r, "/?github=error&reason=token_exchange", http.StatusFound)
		return
	}
	ghUser, err := store.githubCurrentUser(r.Context(), token.AccessToken)
	if err != nil {
		log.Printf("github user fetch: %v", err)
		http.Redirect(w, r, "/?github=error&reason=user_fetch", http.StatusFound)
		return
	}
	if err := store.saveGitHubConnection(r.Context(), userID, ghUser, token); err != nil {
		log.Printf("save github connection: %v", err)
		http.Redirect(w, r, "/?github=error&reason=save_connection", http.StatusFound)
		return
	}
	http.Redirect(w, r, store.githubReturnURL("connected"), http.StatusFound)
}

func (store *projectStore) githubReturnURL(status string) string {
	base := store.githubPublicURL
	if base == "" {
		base = "/"
	}
	if !strings.HasSuffix(base, "/") {
		base += "/"
	}
	return base + "?github=" + url.QueryEscape(status)
}

func (store *projectStore) exchangeGitHubCode(ctx context.Context, code string) (githubTokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", store.githubClientID)
	form.Set("client_secret", store.githubClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", store.githubRedirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return githubTokenResponse{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := upstreamClient.Do(req)
	if err != nil {
		return githubTokenResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return githubTokenResponse{}, fmt.Errorf("GitHub token exchange returned %s", resp.Status)
	}
	var token githubTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return githubTokenResponse{}, err
	}
	if token.AccessToken == "" {
		return githubTokenResponse{}, errors.New("GitHub did not return an access token")
	}
	return token, nil
}

func (store *projectStore) githubCurrentUser(ctx context.Context, accessToken string) (githubUserResponse, error) {
	var user githubUserResponse
	if err := store.githubJSON(ctx, accessToken, http.MethodGet, "https://api.github.com/user", nil, &user); err != nil {
		return user, err
	}
	return user, nil
}

func (store *projectStore) saveGitHubConnection(ctx context.Context, userID string, ghUser githubUserResponse, token githubTokenResponse) error {
	accessCipher, err := store.encryptSecret(token.AccessToken)
	if err != nil {
		return err
	}
	var refreshCipher any
	if token.RefreshToken != "" {
		refreshCipher, err = store.encryptSecret(token.RefreshToken)
		if err != nil {
			return err
		}
	}
	var expiresAt any
	if token.ExpiresIn > 0 {
		expiresAt = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)
	}
	var refreshExpiresAt any
	if token.RefreshTokenExpiresIn > 0 {
		refreshExpiresAt = time.Now().Add(time.Duration(token.RefreshTokenExpiresIn) * time.Second)
	}
	_, err = store.pool.Exec(ctx, `
		insert into github_connections(user_id,github_user_id,login,avatar_url,access_token_enc,refresh_token_enc,token_expires_at,refresh_token_expires_at,updated_at)
		values($1,$2,$3,$4,$5,$6,$7,$8,now())
		on conflict (user_id) do update set github_user_id=excluded.github_user_id, login=excluded.login, avatar_url=excluded.avatar_url, access_token_enc=excluded.access_token_enc, refresh_token_enc=excluded.refresh_token_enc, token_expires_at=excluded.token_expires_at, refresh_token_expires_at=excluded.refresh_token_expires_at, updated_at=now()`,
		userID, ghUser.ID, ghUser.Login, ghUser.AvatarURL, accessCipher, refreshCipher, expiresAt, refreshExpiresAt)
	return err
}

func (store *projectStore) githubStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}
	userID, authenticated, err := store.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !authenticated {
		writeError(w, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	if store.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"connected": false, "configured": false})
		return
	}
	var connection GitHubConnection
	var connectedAt time.Time
	err = store.pool.QueryRow(r.Context(), `select id,github_user_id,login,coalesce(avatar_url,''),created_at from github_connections where user_id=$1`, userID).Scan(&connection.ID, &connection.GitHubUserID, &connection.Login, &connection.AvatarURL, &connectedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]any{"connected": false, "configured": store.githubConfigured()})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	connection.ConnectedAt = connectedAt.Format(time.RFC3339)
	var repoCount int
	_ = store.pool.QueryRow(r.Context(), `select count(*) from github_repositories where connection_id=$1`, connection.ID).Scan(&repoCount)
	writeJSON(w, http.StatusOK, map[string]any{"connected": true, "configured": store.githubConfigured(), "connection": connection, "repositoryCount": repoCount})
}

func (store *projectStore) githubDisconnectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}
	userID, authenticated, err := store.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !authenticated {
		writeError(w, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	if store.pool == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"connected": false})
		return
	}
	_, err = store.pool.Exec(r.Context(), `delete from github_connections where user_id=$1`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"connected": false})
}

func (store *projectStore) githubRepositoriesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}
	userID, authenticated, err := store.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !authenticated {
		writeError(w, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	accessToken, connectionID, err := store.githubAccessToken(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	var repos []githubRepoResponse
	reqURL := "https://api.github.com/user/repos?per_page=100&sort=updated&direction=desc"
	if query := strings.TrimSpace(r.URL.Query().Get("q")); query != "" {
		// Keep the API request simple: filter locally after fetching accessible repos.
		_ = query
	}
	if err := store.githubJSON(r.Context(), accessToken, http.MethodGet, reqURL, nil, &repos); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	result := make([]GitHubRepository, 0, len(repos))
	search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	for _, repo := range repos {
		if search != "" && !strings.Contains(strings.ToLower(repo.FullName+" "+repo.Name+" "+repo.Description), search) {
			continue
		}
		var dbID string
		err := store.pool.QueryRow(r.Context(), `
			insert into github_repositories(connection_id,github_repo_id,owner,name,full_name,html_url,default_branch,private,description,updated_at)
			values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
			on conflict(connection_id,github_repo_id) do update set owner=excluded.owner,name=excluded.name,full_name=excluded.full_name,html_url=excluded.html_url,default_branch=excluded.default_branch,private=excluded.private,description=excluded.description,updated_at=excluded.updated_at
			returning id`, connectionID, repo.ID, repo.Owner.Login, repo.Name, repo.FullName, repo.HTMLURL, repo.DefaultBranch, repo.Private, repo.Description, parseGitHubTime(repo.UpdatedAt)).Scan(&dbID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		var linkedProjectID string
		_ = store.pool.QueryRow(r.Context(), `select p.id from projects p where p.github_repository_id=$1 and p.owner_id=$2`, dbID, userID).Scan(&linkedProjectID)
		result = append(result, GitHubRepository{ID: dbID, GitHubRepoID: repo.ID, Owner: repo.Owner.Login, Name: repo.Name, FullName: repo.FullName, HTMLURL: repo.HTMLURL, DefaultBranch: repo.DefaultBranch, Private: repo.Private, Description: repo.Description, UpdatedAt: repo.UpdatedAt, LinkedProjectID: linkedProjectID})
	}
	writeJSON(w, http.StatusOK, result)
}

func parseGitHubTime(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Now()
	}
	return parsed
}

func (store *projectStore) githubAccessToken(ctx context.Context, userID string) (string, string, error) {
	var connectionID, accessEnc string
	var refreshEnc []byte
	var expiresAt, refreshExpiresAt *time.Time
	err := store.pool.QueryRow(ctx, `select id,access_token_enc,refresh_token_enc,token_expires_at,refresh_token_expires_at from github_connections where user_id=$1`, userID).Scan(&connectionID, &accessEnc, &refreshEnc, &expiresAt, &refreshExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", errors.New("GitHub is not connected")
	}
	if err != nil {
		return "", "", err
	}
	accessToken, err := store.decryptSecret(accessEnc)
	if err != nil {
		return "", "", err
	}
	if expiresAt == nil || time.Until(*expiresAt) > 90*time.Second {
		return accessToken, connectionID, nil
	}
	if len(refreshEnc) == 0 || (refreshExpiresAt != nil && time.Now().After(*refreshExpiresAt)) {
		return "", "", errors.New("GitHub session expired; reconnect GitHub")
	}
	refreshToken, err := store.decryptSecret(string(refreshEnc))
	if err != nil {
		return "", "", err
	}
	newToken, err := store.refreshGitHubToken(ctx, refreshToken)
	if err != nil {
		return "", "", err
	}
	accessCipher, err := store.encryptSecret(newToken.AccessToken)
	if err != nil {
		return "", "", err
	}
	var newRefreshCipher any = string(refreshEnc)
	if newToken.RefreshToken != "" {
		newRefreshCipher, err = store.encryptSecret(newToken.RefreshToken)
		if err != nil {
			return "", "", err
		}
	}
	var newExpires any
	if newToken.ExpiresIn > 0 {
		newExpires = time.Now().Add(time.Duration(newToken.ExpiresIn) * time.Second)
	}
	var newRefreshExpires any
	if newToken.RefreshTokenExpiresIn > 0 {
		newRefreshExpires = time.Now().Add(time.Duration(newToken.RefreshTokenExpiresIn) * time.Second)
	}
	_, err = store.pool.Exec(ctx, `update github_connections set access_token_enc=$2,refresh_token_enc=$3,token_expires_at=$4,refresh_token_expires_at=coalesce($5,refresh_token_expires_at),updated_at=now() where id=$1`, connectionID, accessCipher, newRefreshCipher, newExpires, newRefreshExpires)
	if err != nil {
		return "", "", err
	}
	return newToken.AccessToken, connectionID, nil
}

func (store *projectStore) refreshGitHubToken(ctx context.Context, refreshToken string) (githubTokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", store.githubClientID)
	form.Set("client_secret", store.githubClientSecret)
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return githubTokenResponse{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := upstreamClient.Do(req)
	if err != nil {
		return githubTokenResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return githubTokenResponse{}, fmt.Errorf("GitHub token refresh returned %s", resp.Status)
	}
	var token githubTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return githubTokenResponse{}, err
	}
	if token.AccessToken == "" {
		return githubTokenResponse{}, errors.New("GitHub token refresh failed")
	}
	return token, nil
}

func (store *projectStore) githubJSON(ctx context.Context, accessToken, method, endpoint string, body io.Reader, result any) error {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	resp, err := upstreamClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		return fmt.Errorf("GitHub API returned %s: %s", resp.Status, strings.TrimSpace(string(payload)))
	}
	if result == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(result)
}

func (store *projectStore) loadProjectGitHub(ctx context.Context, project *Project) error {
	if store.pool == nil {
		return nil
	}
	return loadProjectGitHubFrom(ctx, store.pool, project)
}

func loadProjectGitHubFrom(ctx context.Context, reader projectReader, project *Project) error {
	var repo GitHubRepository
	var updatedAt time.Time
	err := reader.QueryRow(ctx, `
		select r.id,r.github_repo_id,r.owner,r.name,r.full_name,r.html_url,r.default_branch,r.private,coalesce(r.description,''),r.updated_at
		from github_repositories r join projects p on p.github_repository_id=r.id
		where p.id=$1`, project.ID).Scan(&repo.ID, &repo.GitHubRepoID, &repo.Owner, &repo.Name, &repo.FullName, &repo.HTMLURL, &repo.DefaultBranch, &repo.Private, &repo.Description, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		project.GitHub = nil
		return nil
	}
	if err != nil {
		return err
	}
	repo.UpdatedAt = updatedAt.Format(time.RFC3339)
	project.GitHub = &repo
	return nil
}

func (store *projectStore) projectGitHubHandler(w http.ResponseWriter, r *http.Request) {
	prefix := "/api/projects/"
	raw := strings.TrimPrefix(r.URL.Path, prefix)
	parts := strings.Split(strings.Trim(raw, "/"), "/")
	if len(parts) != 2 || parts[1] != "github" {
		http.NotFound(w, r)
		return
	}
	projectID := parts[0]
	userID, authenticated, err := store.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !authenticated {
		writeError(w, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	tx, err := store.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	defer tx.Rollback(r.Context())
	switch r.Method {
	case http.MethodPost:
		var body struct {
			RepositoryID string `json:"repositoryId"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if strings.TrimSpace(body.RepositoryID) == "" {
			writeError(w, http.StatusBadRequest, errors.New("repositoryId is required"))
			return
		}
		var repo GitHubRepository
		var updatedAt time.Time
		err = tx.QueryRow(r.Context(), `select r.id,r.github_repo_id,r.owner,r.name,r.full_name,r.html_url,r.default_branch,r.private,coalesce(r.description,''),r.updated_at from github_repositories r join github_connections c on c.id=r.connection_id where r.id=$1 and c.user_id=$2`, body.RepositoryID, userID).Scan(&repo.ID, &repo.GitHubRepoID, &repo.Owner, &repo.Name, &repo.FullName, &repo.HTMLURL, &repo.DefaultBranch, &repo.Private, &repo.Description, &updatedAt)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, http.StatusNotFound, errors.New("repository not found"))
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		var owner string
		var projectEncrypted bool
		err = tx.QueryRow(r.Context(), `select owner_id,coalesce(is_encrypted,false) from projects where id=$1 for update`, projectID).Scan(&owner, &projectEncrypted)
		if err != nil || owner != userID {
			writeError(w, http.StatusNotFound, errors.New("project not found"))
			return
		}
		var existing string
		if err := tx.QueryRow(r.Context(), `select id from projects where github_repository_id=$1 and id<>$2`, body.RepositoryID, projectID).Scan(&existing); err == nil {
			writeError(w, http.StatusConflict, errors.New("repository is already linked to another project"))
			return
		}
		_, err = tx.Exec(r.Context(), `update projects set github_repository_id=$1,updated_at=now() where id=$2 and owner_id=$3`, body.RepositoryID, projectID, userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if !projectEncrypted {
			_, _ = tx.Exec(r.Context(), `insert into project_activity(project_id,action,detail) values($1,$2,$3)`, projectID, "github.linked", "Linked GitHub repository "+repo.FullName+".")
		}
		if err := tx.Commit(r.Context()); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		repo.UpdatedAt = updatedAt.Format(time.RFC3339)
		writeJSON(w, http.StatusOK, repo)
	case http.MethodDelete:
		var projectEncrypted bool
		err := tx.QueryRow(r.Context(), `select coalesce(is_encrypted,false) from projects where id=$1 and owner_id=$2 for update`, projectID, userID).Scan(&projectEncrypted)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, errors.New("project not found"))
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		res, err := tx.Exec(r.Context(), `update projects set github_repository_id=null,updated_at=now() where id=$1 and owner_id=$2`, projectID, userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if res.RowsAffected() == 0 {
			writeError(w, http.StatusNotFound, errors.New("project not found"))
			return
		}
		if !projectEncrypted {
			_, _ = tx.Exec(r.Context(), `insert into project_activity(project_id,action,detail) values($1,$2,$3)`, projectID, "github.unlinked", "Unlinked GitHub repository.")
		}
		if err := tx.Commit(r.Context()); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Allow", "POST, DELETE")
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

func parseEncryptionKey(value string) []byte {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if b, err := base64.StdEncoding.DecodeString(value); err == nil && len(b) == 32 {
		return b
	}
	if b, err := hex.DecodeString(value); err == nil && len(b) == 32 {
		return b
	}
	return nil
}

func (store *projectStore) encryptSecret(plain string) (string, error) {
	if len(store.githubTokenKey) != 32 {
		return "", errors.New("GITHUB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes")
	}
	block, err := aes.NewCipher(store.githubTokenKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func (store *projectStore) decryptSecret(value string) (string, error) {
	if len(store.githubTokenKey) != 32 {
		return "", errors.New("GITHUB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes")
	}
	payload, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(store.githubTokenKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(payload) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted token")
	}
	nonce, ciphertext := payload[:gcm.NonceSize()], payload[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", errors.New("unable to decrypt GitHub token")
	}
	return string(plain), nil
}

func normalizeProject(project *Project) {
	project.Name = strings.TrimSpace(project.Name)
	project.Slug = slugify(project.Slug)
	if project.Slug == "" {
		project.Slug = slugify(project.Name)
	}
	project.Description = strings.TrimSpace(project.Description)
	project.Category = strings.TrimSpace(project.Category)
	project.Notes = strings.TrimSpace(project.Notes)
	if project.Status == "" {
		project.Status = "active"
	}
	if project.Priority == "" {
		project.Priority = "normal"
	}
	for i := range project.Technologies {
		project.Technologies[i].Name = strings.TrimSpace(project.Technologies[i].Name)
	}
}

func validateProject(project Project) error {
	if project.Name == "" {
		return errors.New("project name is required")
	}
	validStatus := map[string]bool{"idea": true, "active": true, "shipped": true, "archived": true}
	validPriority := map[string]bool{"low": true, "normal": true, "high": true}
	if !validStatus[project.Status] {
		return errors.New("invalid project status")
	}
	if !validPriority[project.Priority] {
		return errors.New("invalid project priority")
	}
	if len(project.Name) > 120 {
		return errors.New("project name is too long")
	}
	for _, link := range project.Links {
		if link.Label != "" && link.URL != "" {
			if _, err := url.ParseRequestURI(link.URL); err != nil {
				return fmt.Errorf("invalid link URL: %s", link.Label)
			}
		}
	}
	for _, deployment := range project.Deployments {
		if deployment.URL != "" {
			if err := validateHTTPURL(deployment.URL); err != nil {
				return fmt.Errorf("invalid deployment URL: %w", err)
			}
		}
	}
	return nil
}

func validateHTTPURL(value string) error {
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Host == "" {
		return errors.New("URL must be absolute")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return errors.New("URL must use http or https")
	}
	return nil
}

func cloneProject(project Project) Project {
	cloned := project
	if project.Legacy != nil {
		legacy := *project.Legacy
		cloned.Legacy = &legacy
	}
	if project.EncryptedPayload != nil {
		payload := *project.EncryptedPayload
		cloned.EncryptedPayload = &payload
	}
	cloned.Technologies = append([]Technology(nil), project.Technologies...)
	cloned.Domains = append([]Domain(nil), project.Domains...)
	cloned.Deployments = append([]Deployment(nil), project.Deployments...)
	cloned.Databases = append([]ProjectDB(nil), project.Databases...)
	cloned.Links = append([]ProjectLink(nil), project.Links...)
	cloned.Activities = append([]Activity(nil), project.Activities...)
	if project.GitHub != nil {
		repo := *project.GitHub
		cloned.GitHub = &repo
	}
	return cloned
}

func sortProjects(projects []Project) {
	for i := 1; i < len(projects); i++ {
		current := projects[i]
		j := i - 1
		for j >= 0 && projects[j].UpdatedAt < current.UpdatedAt {
			projects[j+1] = projects[j]
			j--
		}
		projects[j+1] = current
	}
}

func slugify(input string) string {
	value := strings.ToLower(strings.TrimSpace(input))
	value = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(value, "-")
	return strings.Trim(value, "-")
}

func newPreviewID() string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d-%d", time.Now().UnixNano(), time.Now().UnixNano()%997)))
	return "preview-" + hex.EncodeToString(sum[:])[:20]
}

func defaultKind(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
func nullIfEmpty(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}
func isLocalURL(value *url.URL) bool {
	return value.Hostname() == "localhost" || value.Hostname() == "127.0.0.1"
}

func copyResponseHeaders(destination http.ResponseWriter, source http.Header) {
	for key, values := range source {
		for _, value := range values {
			destination.Header().Add(key, value)
		}
	}
}

func setJSONHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	setJSONHeaders(w)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}
