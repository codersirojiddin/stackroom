"""Imported by vault_browser_test.py; real browser encryption, mocked storage failures."""

import copy
import hashlib
import json
from urllib.parse import urlparse

from playwright.sync_api import expect


def run_migration_checks(browser, url, passphrase):
    context = browser.new_context()
    context.route("https://**", lambda route: route.abort())
    page = context.new_page()
    page.set_default_timeout(10000)
    errors, writes = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    backend = {"vault": None, "projects": {}, "fail": {"legacy-fail"}, "lost": {"legacy-lost"}}

    def revision(source):
        return '"' + hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest() + '"'

    def route_api(route):
        request = route.request
        path, method = urlparse(request.url).path, request.method
        data = json.loads(request.post_data or "{}")
        status, response = 200, {}
        if path == "/api/auth/get-session":
            response = {"user": {"id": "migration-user"}, "session": {"id": "test"}}
        elif path == "/api/vault":
            if method == "POST":
                backend["vault"] = data
            response = {"exists": backend["vault"] is not None, "vault": backend["vault"]}
        elif path == "/api/projects":
            response = list(backend["projects"].values())
        elif path.startswith("/api/projects/"):
            project_id = path.split("/")[3]
            source = backend["projects"][project_id]
            if path.endswith("/migrate"):
                if method == "GET":
                    response = copy.deepcopy(source)
                    if not source.get("isEncrypted"):
                        response["migrationRevision"] = revision(source)
                else:
                    writes.append((project_id, copy.deepcopy(data), request.headers.get("if-match")))
                    if source.get("isEncrypted"):
                        response = source
                    elif project_id in backend["fail"]:
                        status = 503
                    elif request.headers.get("if-match") != revision(source):
                        status = 412
                    else:
                        response = {**data, **{key: source[key] for key in ("id", "createdAt", "updatedAt", "github")}}
                        backend["projects"][project_id] = response
                        if project_id in backend["lost"]:
                            backend["lost"].remove(project_id)
                            status, response = 503, {}
            elif method == "PATCH":
                response = {**data, **{key: source[key] for key in ("id", "createdAt", "updatedAt", "github")}}
                backend["projects"][project_id] = response
            elif method == "DELETE":
                del backend["projects"][project_id]
            else:
                response = source
        elif path.endswith("/github/status"):
            response = {"connected": True, "configured": True, "connection": {"login": "tester"}}
        route.fulfill(status=status, content_type="application/json", body=json.dumps(response))

    context.route("**/api/**", route_api)

    def unlock():
        page.locator("#privacyVaultPassphrase").fill(passphrase)
        if page.locator("#privacyVaultConfirmField").is_visible():
            page.locator("#privacyVaultConfirm").fill(passphrase)
        page.locator("#privacyVaultSubmit").click()
        expect(page.locator("#privacyVaultBackdrop")).to_be_hidden()

    page.goto(url)
    expect(page.locator("#privacyVaultTitle")).to_have_text("Create your private vault")
    unlock()
    source = {
        "id": "legacy-good", "name": "Legacy private archive", "description": "Old private description",
        "notes": "Old private notes", "status": "idea", "priority": "high", "category": "Archive",
        "slug": "legacy-private-archive", "isEncrypted": False,
        "createdAt": "2021-02-03T04:05:06.123456Z", "updatedAt": "2022-03-04T05:06:07.654321Z",
        "github": {"id": "repo-1", "fullName": "tester/legacy-repository"},
        "legacy": {"stack": "Go, SQL", "domain": "old.example", "deployedUrl": "https://old.example"},
        "technologies": [{"name": "Go", "kind": "language"}],
        "domains": [{"hostname": "rich.example", "notes": "Private DNS notes", "autoRenew": True}],
        "deployments": [{"name": "Staging", "url": "https://staging.example", "notes": "Private deployment notes"}],
        "databases": [{"name": "Primary", "provider": "Neon", "notes": "Private database notes"}],
        "links": [{"label": "Private docs", "url": "https://docs.example", "kind": "docs"}],
        "activities": [{"action": "updated", "detail": f"Private activity {index}", "createdAt": "2022-01-01T00:00:00Z"} for index in range(30)],
    }
    for project_id in ("legacy-fail", "legacy-good", "legacy-lost"):
        backend["projects"][project_id] = {**copy.deepcopy(source), "id": project_id}
    encrypted_payload = page.evaluate("data => StackroomCrypto.encryptJSON(state.vault.masterKey, data)", {"name": "Previously encrypted", "status": "active"})
    encrypted = {"id": "encrypted-1", "isEncrypted": True, "encryptedPayload": encrypted_payload,
                 "encryptionVersion": 1, "createdAt": source["createdAt"], "updatedAt": source["updatedAt"], "github": None}
    backend["projects"]["encrypted-1"] = copy.deepcopy(encrypted)
    page.reload()
    expect(page.locator("#privacyVaultTitle")).to_have_text("Unlock your private vault")
    assert not writes, "Migration started before unlocking"
    # Hold the first encryption to inspect progress and guard against overlapping batches.
    page.evaluate("""() => {
        const encrypt = StackroomCrypto.encryptJSON;
        StackroomCrypto.encryptJSON = async (...args) => {
            if (!window.migrationPaused) {
                window.migrationPaused = true;
                await new Promise(resolve => window.resumeMigration = resolve);
            }
            return encrypt(...args);
        };
    }""")
    unlock()
    page.wait_for_function("typeof resumeMigration === 'function'")
    expect(page.locator("#migrationMessage")).to_contain_text("Encrypting older projects")
    page.evaluate("migrateLegacyProjects()")
    assert not writes
    page.evaluate("() => resumeMigration()")
    expect(page.locator("#retryMigrationButton")).to_be_visible()
    assert len(writes) == 3 and all(project_id != "encrypted-1" for project_id, _, _ in writes)
    assert backend["projects"]["legacy-fail"] == {**source, "id": "legacy-fail"}
    for project_id in ("legacy-good", "legacy-lost"):
        saved = backend["projects"][project_id]
        assert saved["isEncrypted"] and saved["encryptionVersion"] == 1
        assert all(key not in saved for key in ("name", "notes", "legacy", "domains", "deployments", "databases", "links", "technologies", "activities"))
        assert all(saved[key] == source[key] for key in ("createdAt", "updatedAt", "github"))
        private = page.evaluate("payload => StackroomCrypto.decryptJSON(state.vault.masterKey, payload)", saved["encryptedPayload"])
        assert private["name"] == source["name"] and private["notes"] == source["notes"]
        assert private["activities"] == source["activities"] and private["legacy"] == source["legacy"]
        assert any(domain["hostname"] == "old.example" for domain in private["domains"])
        assert private["databases"] == source["databases"] and private["links"] == source["links"]
    assert backend["projects"]["encrypted-1"] == encrypted
    for _, data, token in writes:
        assert set(data) == {"encryptedPayload", "encryptionVersion", "isEncrypted"}
        assert token and passphrase not in json.dumps(data)
        assert all(secret not in json.dumps(data) for secret in (source["name"], source["notes"], "Private DNS notes", "old.example"))
    backend["fail"].clear()
    page.locator("#retryMigrationButton").click()
    expect(page.locator("#migrationMessage")).to_contain_text("now protected")
    assert len(writes) == 4, "The committed migration with a lost response was submitted again"
    migrated_records = copy.deepcopy(backend["projects"])
    page.reload()
    unlock()
    expect(page.locator("#projectGrid")).to_contain_text("Legacy private archive")
    page.evaluate("migrateLegacyProjects()")
    assert len(writes) == 4 and backend["projects"] == migrated_records

    page.locator("#searchInput").fill("Private DNS notes")
    expect(page.locator("#resultsLabel")).to_contain_text("0 projects")
    page.locator("#searchInput").fill("old.example")
    expect(page.locator("#resultsLabel")).to_contain_text("3 projects")
    page.locator("#filterButton").click()
    page.locator('[data-filter="idea"]').click()
    expect(page.locator("#resultsLabel")).to_contain_text("3 projects")
    page.locator('[data-nav="domains"]').click()
    expect(page.locator("#domainsTable")).to_contain_text("old.example")
    page.locator('[data-nav="attention"]').click()
    expect(page.locator("#attentionGrid")).to_contain_text("Legacy private archive")
    page.locator('[data-nav="projects"]').click()
    page.locator('.project-card[data-id="legacy-good"] [data-action="open"]').first.click()
    expect(page.locator("#detailGrid")).to_contain_text("tester/legacy-repository")
    page.locator("#detailEditButton").click()
    page.locator("#projectForm [name=notes]").fill("Edited migrated notes")
    page.locator("#saveProjectButton").click()
    expect(page.locator("#detailGrid")).to_contain_text("Edited migrated notes")
    edited = page.evaluate("payload => StackroomCrypto.decryptJSON(state.vault.masterKey, payload)", backend["projects"]["legacy-good"]["encryptedPayload"])
    assert len(edited["activities"]) == 31 and edited["legacy"] == source["legacy"]
    page.on("dialog", lambda dialog: dialog.accept())
    page.locator("#detailDeleteButton").click()
    expect(page.locator('#projectGrid .project-card[data-id="legacy-good"]')).to_have_count(0)
    assert "legacy-good" not in backend["projects"]

    # Reject a source changed while browser encryption is pending, then retry the new snapshot.
    backend["projects"]["legacy-changing"] = {**copy.deepcopy(source), "id": "legacy-changing"}
    page.evaluate("""() => {
        const encrypt = StackroomCrypto.encryptJSON;
        StackroomCrypto.encryptJSON = async (...args) => {
            if (!window.migrationPaused) {
                window.migrationPaused = true;
                await new Promise(resolve => window.resumeMigration = resolve);
            }
            return encrypt(...args);
        };
    }""")
    page.evaluate("() => { window.migrationPaused = false; delete window.resumeMigration; void loadProjects(); }")
    page.wait_for_function("typeof resumeMigration === 'function'")
    backend["projects"]["legacy-changing"]["notes"] = "A newer edit from another tab"
    page.evaluate("() => resumeMigration()")
    expect(page.locator("#retryMigrationButton")).to_be_visible()
    assert backend["projects"]["legacy-changing"]["notes"] == "A newer edit from another tab"
    assert not backend["projects"]["legacy-changing"]["isEncrypted"]
    page.locator("#retryMigrationButton").click()
    expect(page.locator("#migrationMessage")).to_contain_text("now protected")
    updated = page.evaluate("payload => StackroomCrypto.decryptJSON(state.vault.masterKey, payload)", backend["projects"]["legacy-changing"]["encryptedPayload"])
    assert updated["notes"] == "A newer edit from another tab"

    # Locking during migration must leave the source intact and clear progress state.
    backend["projects"]["legacy-lock"] = {**copy.deepcopy(source), "id": "legacy-lock"}
    before_lock = len(writes)
    page.evaluate("() => { window.migrationPaused = false; delete window.resumeMigration; window.pendingMigration = loadProjects(); }")
    page.wait_for_function("typeof resumeMigration === 'function'")
    page.locator("#avatarButton").click()
    page.locator("#lockVaultButton").click()
    expect(page.locator("#privacyVaultTitle")).to_have_text("Unlock your private vault")
    page.evaluate("async () => { resumeMigration(); await pendingMigration; }")
    assert len(writes) == before_lock and not backend["projects"]["legacy-lock"]["isEncrypted"]
    assert page.evaluate("state.migration === null && state.vault.masterKey === null && state.projects.length === 0")
    expect(page.locator("#migrationStatus")).to_be_hidden()
    assert not errors, errors
    print("PASS legacy detection, local encryption, plaintext cleanup, per-project failure/retry, lost response, idempotence, timestamps, GitHub, migrated CRUD/views, stale source, and lock cancellation")
    context.close()
