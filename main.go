package main

import (
	"context"
	"crypto/sha256"
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

type Project struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Slug         string        `json:"slug"`
	Description  string        `json:"description"`
	Status       string        `json:"status"`
	Category     string        `json:"category"`
	Priority     string        `json:"priority"`
	Technologies []Technology  `json:"technologies"`
	Domains      []Domain      `json:"domains"`
	Deployments  []Deployment  `json:"deployments"`
	Databases    []ProjectDB   `json:"databases"`
	Links        []ProjectLink `json:"links"`
	Notes        string        `json:"notes"`
	Activities   []Activity    `json:"activities"`
	CreatedAt    string        `json:"createdAt"`
	UpdatedAt    string        `json:"updatedAt"`
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

type projectStore struct {
	pool        *pgxpool.Pool
	authBaseURL string
	memory      map[string]Project
	memoryMu    sync.RWMutex
}

func main() {
	_ = godotenv.Load()

	store := &projectStore{memory: make(map[string]Project)}
	store.authBaseURL = strings.TrimRight(os.Getenv("NEON_AUTH_BASE_URL"), "/")

	if connectionString := os.Getenv("DATABASE_URL"); connectionString != "" {
		pool, err := pgxpool.New(context.Background(), connectionString)
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
	mux.HandleFunc("/api/projects", store.projectsHandler)
	mux.HandleFunc("/api/projects/", store.projectHandler)
	mux.Handle("/", http.FileServer(http.Dir(".")))

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
		normalizeProject(&project)
		if err := validateProject(project); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		project.ID = rawID
		updated, err := store.updateProject(r.Context(), project, userID)
		if err != nil {
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
               coalesce(category, ''), coalesce(priority, 'normal'), coalesce(notes, ''), created_at, updated_at
        from projects where owner_id = $1 order by updated_at desc, created_at desc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var project Project
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&project.ID, &project.Name, &project.Slug, &project.Description, &project.Status, &project.Category, &project.Priority, &project.Notes, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		project.CreatedAt = createdAt.Format(time.RFC3339)
		project.UpdatedAt = updatedAt.Format(time.RFC3339)
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

	var project Project
	var createdAt, updatedAt time.Time
	err := store.pool.QueryRow(ctx, `
        select id, name, coalesce(slug, ''), coalesce(description, ''), status,
               coalesce(category, ''), coalesce(priority, 'normal'), coalesce(notes, ''), created_at, updated_at
        from projects where id = $1 and owner_id = $2`, id, userID).
		Scan(&project.ID, &project.Name, &project.Slug, &project.Description, &project.Status, &project.Category, &project.Priority, &project.Notes, &createdAt, &updatedAt)
	if err != nil {
		return Project{}, err
	}
	project.CreatedAt = createdAt.Format(time.RFC3339)
	project.UpdatedAt = updatedAt.Format(time.RFC3339)
	if err := store.loadProjectChildren(ctx, &project); err != nil {
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
	project.Technologies = nil
	project.Domains = nil
	project.Deployments = nil
	project.Databases = nil
	project.Links = nil

	rows, err := store.pool.Query(ctx, `select id, name, kind from project_technologies where project_id=$1 order by created_at`, project.ID)
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
	rows.Close()

	rows, err = store.pool.Query(ctx, `select id, hostname, coalesce(registrar,''), coalesce(dns_provider,''), coalesce(expires_at::text,''), auto_renew, coalesce(notes,'') from project_domains where project_id=$1 order by created_at`, project.ID)
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
	rows.Close()

	rows, err = store.pool.Query(ctx, `select id, name, coalesce(provider,''), environment, coalesce(url,''), coalesce(repository,''), coalesce(branch,''), status, coalesce(notes,'') from project_deployments where project_id=$1 order by created_at`, project.ID)
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
	rows.Close()

	rows, err = store.pool.Query(ctx, `select id, name, coalesce(provider,''), coalesce(database_type,''), environment, coalesce(url,''), coalesce(notes,'') from project_databases where project_id=$1 order by created_at`, project.ID)
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
	rows.Close()

	rows, err = store.pool.Query(ctx, `select id, label, url, kind from project_links where project_id=$1 order by created_at`, project.ID)
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
	rows.Close()

	rows, err = store.pool.Query(ctx, `select id, action, coalesce(detail,''), created_at::text from project_activity where project_id=$1 order by created_at desc limit 24`, project.ID)
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
	rows.Close()
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

	response, err := http.DefaultClient.Do(req)
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
	response, err := http.DefaultClient.Do(request)
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

func decodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 2<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("invalid JSON body")
	}
	return nil
}

func cloneProject(project Project) Project {
	cloned := project
	cloned.Technologies = append([]Technology(nil), project.Technologies...)
	cloned.Domains = append([]Domain(nil), project.Domains...)
	cloned.Deployments = append([]Deployment(nil), project.Deployments...)
	cloned.Databases = append([]ProjectDB(nil), project.Databases...)
	cloned.Links = append([]ProjectLink(nil), project.Links...)
	cloned.Activities = append([]Activity(nil), project.Activities...)
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

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if r.TLS != nil {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}
