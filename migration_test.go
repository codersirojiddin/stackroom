package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testMigrationRequest() migrationRequest {
	return migrationRequest{IsEncrypted: true, EncryptionVersion: 1, EncryptedPayload: &EncryptedPayload{
		Version: 1, IV: base64.StdEncoding.EncodeToString(make([]byte, 12)),
		Ciphertext: base64.StdEncoding.EncodeToString(make([]byte, 48)),
	}}
}

func testLegacyProject() Project {
	return Project{
		ID: "legacy", Name: "Private name", Notes: "Private notes", Status: "idea", Priority: "high",
		Legacy:       &LegacyProjectFields{Stack: "Go", Domain: "private.example", DeployedURL: "https://private.example"},
		Domains:      []Domain{{Hostname: "private.example", Notes: "DNS notes"}},
		Deployments:  []Deployment{{Name: "Production", Notes: "Deployment notes"}},
		Databases:    []ProjectDB{{Name: "Primary", Notes: "Database notes"}},
		Technologies: []Technology{{Name: "Go"}}, Links: []ProjectLink{{Label: "Docs", URL: "https://docs.example"}},
		Activities: []Activity{{Action: "created", Detail: "Private detail"}},
		CreatedAt:  "2021-01-01T01:02:03.123456Z", UpdatedAt: "2022-01-01T01:02:03.654321Z",
		GitHub: &GitHubRepository{ID: "repository", FullName: "owner/repository"},
	}
}

func migrationHTTP(store *projectStore, method, revision string, body any) *httptest.ResponseRecorder {
	encoded, _ := json.Marshal(body)
	r := httptest.NewRequest(method, "/api/projects/legacy/migrate", bytes.NewReader(encoded))
	if revision != "" {
		r.Header.Set("If-Match", revision)
	}
	w := httptest.NewRecorder()
	store.projectHandler(w, r)
	return w
}

func TestMigrationValidationFailureAndIdempotence(t *testing.T) {
	source := testLegacyProject()
	store := &projectStore{memory: map[string]Project{source.ID: cloneProject(source)}}
	get := migrationHTTP(store, http.MethodGet, "", nil)
	if get.Code != http.StatusOK || get.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("snapshot: %d %s", get.Code, get.Body.String())
	}
	var snapshot Project
	if err := json.Unmarshal(get.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.MigrationRevision == "" || !reflect.DeepEqual(snapshot.Activities, source.Activities) {
		t.Fatal("missing revision or source history")
	}
	valid := testMigrationRequest()
	invalid := testMigrationRequest()
	invalid.EncryptedPayload.IV = "invalid"
	wrongVersion := testMigrationRequest()
	wrongVersion.EncryptionVersion = 2
	for _, test := range []struct {
		name, revision string
		body           any
		status         int
	}{
		{"missing revision", "", valid, http.StatusPreconditionRequired},
		{"stale snapshot", `"old"`, valid, http.StatusPreconditionFailed},
		{"invalid envelope", snapshot.MigrationRevision, invalid, http.StatusBadRequest},
		{"wrong version", snapshot.MigrationRevision, wrongVersion, http.StatusBadRequest},
		{"plaintext rejected", snapshot.MigrationRevision, map[string]any{"name": "private"}, http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := migrationHTTP(store, http.MethodPost, test.revision, test.body)
			if response.Code != test.status || !reflect.DeepEqual(store.memory[source.ID], source) {
				t.Fatalf("failure changed source or wrong status: %d %s", response.Code, response.Body.String())
			}
		})
	}
	// A stale normal edit cannot bypass migration and discard unencrypted history.
	if _, err := store.updateEncryptedProject(context.Background(), Project{ID: source.ID, EncryptedPayload: valid.EncryptedPayload}, "local-preview"); err != errMigrationRequired {
		t.Fatalf("normal edit bypassed migration: %v", err)
	}
	response := migrationHTTP(store, http.MethodPost, snapshot.MigrationRevision, valid)
	if response.Code != http.StatusOK {
		t.Fatalf("migration: %d %s", response.Code, response.Body.String())
	}
	want := migrationReplacement(source, valid)
	if !reflect.DeepEqual(store.memory[source.ID], want) {
		t.Fatal("migration did not replace all plaintext or preserve identity, timestamps and GitHub")
	}
	different := testMigrationRequest()
	different.EncryptedPayload.Ciphertext = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 48))
	response = migrationHTTP(store, http.MethodPost, snapshot.MigrationRevision, different)
	if response.Code != http.StatusOK || !reflect.DeepEqual(store.memory[source.ID], want) {
		t.Fatal("retry overwrote an already encrypted project")
	}
	if _, err := store.updateProject(context.Background(), source, "local-preview"); err != errProjectEncrypted {
		t.Fatal("stale plaintext edit was allowed after migration")
	}
}

func TestMigrationRequiresAuthentication(t *testing.T) {
	auth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{}`)
	}))
	defer auth.Close()
	store := &projectStore{authBaseURL: auth.URL, memory: map[string]Project{"legacy": testLegacyProject()}}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		if response := migrationHTTP(store, method, `"revision"`, testMigrationRequest()); response.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated %s allowed: %d", method, response.Code)
		}
	}
}

// This test uses only an explicitly supplied disposable test database, never DATABASE_URL/.env.
// STACKROOM_TEST_DATABASE_URL=... go test -run TestMigrationPostgres -v
func TestMigrationPostgres(t *testing.T) {
	connectionString := os.Getenv("STACKROOM_TEST_DATABASE_URL")
	if connectionString == "" {
		t.Skip("set STACKROOM_TEST_DATABASE_URL to test real PostgreSQL commit/rollback and cleanup")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	config, err := pgxpool.ParseConfig(connectionString)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("stackroom_migration_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "create schema "+identifier); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := admin.Exec(context.Background(), "drop schema "+identifier+" cascade"); err != nil {
			t.Errorf("test schema cleanup: %v", err)
		}
	}()
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{"schema.sql", "migrations/004_privacy_core.sql"} {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		// The extension belongs to database setup, not this disposable schema.
		exec(strings.ReplaceAll(string(data), "create extension if not exists pgcrypto;", ""))
	}
	id := "00000000-0000-4000-8000-000000000001"
	exec(`insert into github_connections(id,user_id,github_user_id,login,access_token_enc) values('00000000-0000-4000-8000-000000000002','owner',1,'tester','test')`)
	exec(`insert into github_repositories(id,connection_id,github_repo_id,owner,name,full_name,html_url,default_branch,updated_at) values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',1,'tester','repo','tester/repo','https://github.com/tester/repo','main',now())`)
	exec(`insert into projects(id,owner_id,name,slug,description,notes,stack,domain,deployed_url,github_repository_id,created_at,updated_at) values($1,'owner','Private name','private','Private description','Private notes','Go','old.example','https://old.example','00000000-0000-4000-8000-000000000003','2021-01-01T01:02:03.123456Z','2022-01-01T01:02:03.654321Z')`, id)
	exec(`insert into project_domains(project_id,hostname,notes) values($1,'child.example','DNS notes')`, id)
	exec(`insert into project_deployments(project_id,notes) values($1,'Deployment notes')`, id)
	exec(`insert into project_databases(project_id,notes) values($1,'Database notes')`, id)
	exec(`insert into project_technologies(project_id,name) values($1,'Go')`, id)
	exec(`insert into project_links(project_id,label,url) values($1,'Private docs','https://docs.example')`, id)
	exec(`insert into project_activity(project_id,action,detail) select $1,'updated','Private history' from generate_series(1,30)`, id)
	store := &projectStore{pool: pool}
	source, err := store.migrateProject(ctx, id, "owner", "", migrationRequest{}, false)
	if err != nil || len(source.Activities) != 30 {
		t.Fatalf("complete snapshot: %v, activities=%d", err, len(source.Activities))
	}
	request := testMigrationRequest()
	if _, err := store.migrateProject(ctx, id, "another-owner", migrationRevision(source), request, true); err != pgx.ErrNoRows {
		t.Fatalf("ownership check failed: %v", err)
	}
	if _, err := store.migrateProject(ctx, id, "owner", `"stale"`, request, true); err != errMigrationSourceChanged {
		t.Fatalf("stale snapshot check failed: %v", err)
	}
	// Inject a failure after the UPDATE and several child deletions have executed.
	exec(`create function fail_cleanup() returns trigger language plpgsql as $$ begin raise exception 'injected cleanup failure'; end $$`)
	exec(`create trigger fail_cleanup before delete on project_links for each row execute function fail_cleanup()`)
	if _, err := store.migrateProject(ctx, id, "owner", migrationRevision(source), request, true); err == nil {
		t.Fatal("injected cleanup failure was ignored")
	}
	after, err := store.migrateProject(ctx, id, "owner", "", migrationRequest{}, false)
	if err != nil || !reflect.DeepEqual(after, source) {
		t.Fatalf("rollback failed to preserve every source field and child: %v", err)
	}
	exec(`drop trigger fail_cleanup on project_links`)
	saved, err := store.migrateProject(ctx, id, "owner", migrationRevision(source), request, true)
	if err != nil || !reflect.DeepEqual(saved, migrationReplacement(source, request)) {
		t.Fatalf("migration or metadata preservation failed: %v", err)
	}
	var clean bool
	err = pool.QueryRow(ctx, `select is_encrypted and encryption_version=1 and encrypted_payload is not null and name='[encrypted]' and slug is null and description is null and notes is null and stack is null and domain is null and deployed_url is null and category is null from projects where id=$1`, id).Scan(&clean)
	if err != nil || !clean {
		t.Fatalf("plaintext parent cleanup failed: %v", err)
	}
	for _, table := range []string{"project_domains", "project_deployments", "project_databases", "project_technologies", "project_links", "project_activity"} {
		var count int
		if err := pool.QueryRow(ctx, `select count(*) from `+table+` where project_id=$1`, id).Scan(&count); err != nil || count != 0 {
			t.Fatalf("plaintext child cleanup failed for %s: count=%d error=%v", table, count, err)
		}
	}
	retry, err := store.migrateProject(ctx, id, "owner", migrationRevision(source), request, true)
	if err != nil || !reflect.DeepEqual(retry, saved) {
		t.Fatalf("idempotent retry failed: %v", err)
	}
}
