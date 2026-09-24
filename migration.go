package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

var errMigrationSourceChanged = errors.New("project changed; reload its source before migrating")
var errMigrationRequired = errors.New("migrate this legacy project before editing it")
var errProjectEncrypted = errors.New("this project requires an encrypted update")

// No plaintext project fields, passphrase or key are accepted by this endpoint.
type migrationRequest struct {
	EncryptedPayload  *EncryptedPayload `json:"encryptedPayload"`
	EncryptionVersion int               `json:"encryptionVersion"`
	IsEncrypted       bool              `json:"isEncrypted"`
}

func (request migrationRequest) validate() error {
	if !request.IsEncrypted || request.EncryptionVersion != 1 || request.EncryptedPayload == nil || request.EncryptedPayload.Version != 1 {
		return errors.New("a version 1 encrypted payload is required")
	}
	iv, err := base64.StdEncoding.DecodeString(request.EncryptedPayload.IV)
	if err != nil || len(iv) != 12 {
		return errors.New("invalid encrypted payload IV")
	}
	ciphertext, err := base64.StdEncoding.DecodeString(request.EncryptedPayload.Ciphertext)
	if err != nil || len(ciphertext) <= 16 || len(ciphertext) > 8<<20 {
		return errors.New("invalid encrypted payload ciphertext")
	}
	return nil
}

func migrationRevision(project Project) string {
	project.MigrationRevision = ""
	encoded, _ := json.Marshal(project) // Project contains only JSON-compatible fields.
	digest := sha256.Sum256(encoded)
	return `"` + hex.EncodeToString(digest[:]) + `"`
}

func migrationReplacement(source Project, request migrationRequest) Project {
	// Construct from an allowlist so no legacy scalar or child data survives in memory.
	return Project{
		ID: source.ID, CreatedAt: source.CreatedAt, UpdatedAt: source.UpdatedAt,
		GitHub: source.GitHub, IsEncrypted: true,
		EncryptionVersion: request.EncryptionVersion, EncryptedPayload: request.EncryptedPayload,
	}
}

func (store *projectStore) projectMigrationHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/projects/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "migrate" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	userID, authenticated, err := store.userFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !authenticated {
		writeError(w, http.StatusUnauthorized, errors.New("authentication required"))
		return
	}
	var request migrationRequest
	if r.Method == http.MethodPost {
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := request.validate(); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if r.Header.Get("If-Match") == "" {
			writeError(w, http.StatusPreconditionRequired, errors.New("migration source revision is required"))
			return
		}
	}
	project, err := store.migrateProject(r.Context(), parts[0], userID, r.Header.Get("If-Match"), request, r.Method == http.MethodPost)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			writeError(w, http.StatusNotFound, errors.New("project not found"))
		case errors.Is(err, errMigrationSourceChanged):
			writeError(w, http.StatusPreconditionFailed, err)
		default:
			writeError(w, http.StatusInternalServerError, errors.New("unable to migrate project; retry with a fresh source"))
		}
		return
	}
	if !project.IsEncrypted {
		project.MigrationRevision = migrationRevision(project)
	}
	writeJSON(w, http.StatusOK, project)
}

func (store *projectStore) migrateProject(ctx context.Context, id, userID, revision string, request migrationRequest, write bool) (Project, error) {
	if store.pool == nil {
		store.memoryMu.Lock()
		defer store.memoryMu.Unlock()
		source, ok := store.memory[id]
		if !ok {
			return Project{}, pgx.ErrNoRows
		}
		if !write || source.IsEncrypted {
			return cloneProject(source), nil
		}
		if migrationRevision(source) != revision {
			return Project{}, errMigrationSourceChanged
		}
		replacement := migrationReplacement(source, request)
		store.memory[id] = cloneProject(replacement)
		return replacement, nil
	}
	options := pgx.TxOptions{IsoLevel: pgx.RepeatableRead}
	if !write {
		options.AccessMode = pgx.ReadOnly
	}
	tx, err := store.pool.BeginTx(ctx, options)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback(ctx)
	return migrateProjectTransaction(ctx, tx, id, userID, revision, request, write)
}

func migrateProjectTransaction(ctx context.Context, tx pgx.Tx, id, userID, revision string, request migrationRequest, write bool) (Project, error) {
	if write {
		// Normal edits and GitHub changes also lock the parent before modifying children.
		var lockedID string
		if err := tx.QueryRow(ctx, `select id from projects where id=$1 and owner_id=$2 for update`, id, userID).Scan(&lockedID); err != nil {
			return Project{}, err
		}
	}
	source, err := getProjectFrom(ctx, tx, id, userID)
	if err != nil {
		return Project{}, err
	}
	// A retry after a lost response or another tab's migration returns the canonical ciphertext.
	if !write || source.IsEncrypted {
		return source, nil
	}
	if migrationRevision(source) != revision {
		return Project{}, errMigrationSourceChanged
	}
	encrypted, err := encryptedPayloadJSON(request.EncryptedPayload)
	if err != nil {
		return Project{}, err
	}
	result, err := tx.Exec(ctx, `update projects
		set encrypted_payload=$3, encryption_version=$4, is_encrypted=true,
		    name='[encrypted]', slug=null, description=null, status='active',
		    category=null, priority='normal', stack=null, domain=null, deployed_url=null, notes=null
		where id=$1 and owner_id=$2 and coalesce(is_encrypted,false)=false`,
		id, userID, encrypted, request.EncryptionVersion)
	if err != nil {
		return Project{}, err
	}
	if result.RowsAffected() != 1 {
		return Project{}, errMigrationSourceChanged
	}
	for _, table := range []string{"project_technologies", "project_domains", "project_deployments", "project_databases", "project_links", "project_activity"} {
		if _, err := tx.Exec(ctx, `delete from `+table+` where project_id=$1`, id); err != nil {
			return Project{}, err
		}
	}
	// Payload storage and every plaintext deletion become visible together, or all roll back.
	if err := tx.Commit(ctx); err != nil {
		return Project{}, err
	}
	return migrationReplacement(source, request), nil
}
