"""Vault regression checks with real browser crypto and mocked API responses.

Run: python -m pip install playwright
     python tests/vault_browser_test.py
Requires installed Google Chrome. No Neon credentials or live data are used.
"""

import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright
from legacy_migration_browser_test import run_migration_checks


ROOT = Path(__file__).resolve().parents[1]
PASSPHRASE = "cedar meadow lantern orbit"
PRIVATE_NAME = "Private regression project"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def run():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
            context = browser.new_context()
            page = context.new_page()
            page.set_default_timeout(10000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            backend = {"vault": None, "projects": [], "fail_get": False,
                       "fail_create": False, "fail_signout": False, "conflict": False}
            writes = []

            def route_api(route):
                request = route.request
                path = urlparse(request.url).path
                method = request.method
                data = json.loads(request.post_data or "{}")
                if method in ("POST", "PATCH"):
                    writes.append((path, data))
                status, response = 200, {}
                if path == "/api/auth/get-session":
                    response = {"user": {"id": "test", "name": "Vault tester"}, "session": {"id": "test"}}
                elif path == "/api/auth/sign-out":
                    if backend["fail_signout"]:
                        status = 503
                elif path == "/api/vault":
                    if method == "GET":
                        if backend["fail_get"]:
                            status = 503
                        else:
                            response = {"exists": backend["vault"] is not None, "vault": backend["vault"]}
                    elif backend["fail_create"]:
                        status = 503
                    elif backend["vault"] or backend["conflict"]:
                        if backend["conflict"]:
                            backend["vault"] = data
                        status = 409
                    else:
                        backend["vault"] = data
                        status = 201
                elif path == "/api/projects":
                    if method == "GET":
                        response = backend["projects"]
                    else:
                        response = {**data, "id": "project-1", "createdAt": "2026-09-24T00:00:00Z"}
                        backend["projects"].append(response)
                elif path.endswith("/github"):
                    response = {"id": "repo-1", "fullName": "tester/repository"} if method == "POST" else {}
                    if backend["projects"]:
                        backend["projects"][0]["github"] = response if method == "POST" else None
                elif path.startswith("/api/projects/"):
                    if method == "DELETE":
                        backend["projects"] = []
                        status = 204
                    else:
                        response = {**data, "id": "project-1"}
                        backend["projects"] = [response]
                elif path.endswith("/github/status"):
                    response = {"connected": True, "configured": True, "connection": {"login": "tester"}}
                elif path == "/api/github/repositories":
                    response = [{"id": "repo-1", "fullName": "tester/repository", "private": True}]
                route.fulfill(status=status, content_type="application/json", body=json.dumps(response))

            context.route("**/api/**", route_api)
            context.route("https://fonts.googleapis.com/**", lambda route: route.abort())
            context.route("https://fonts.gstatic.com/**", lambda route: route.abort())
            # Detect persistence attempts, including transient writes later deleted.
            context.add_init_script("""
                window.persistenceWrites = [];
                Storage.prototype.setItem = function(...args) { window.persistenceWrites.push(args); };
                indexedDB.open = function(...args) { window.persistenceWrites.push(args); throw Error('Unexpected IndexedDB use'); };
                Object.defineProperty(document, 'cookie', {get: () => '', set: value => window.persistenceWrites.push(value)});
            """)

            def submit(passphrase=PASSPHRASE, confirm=None):
                page.locator("#privacyVaultPassphrase").fill(passphrase)
                if page.locator("#privacyVaultConfirmField").is_visible():
                    page.locator("#privacyVaultConfirm").fill(passphrase if confirm is None else confirm)
                page.locator("#privacyVaultSubmit").click()

            def unlocked():
                expect(page.locator("#privacyVaultBackdrop")).to_be_hidden()
                assert page.evaluate("state.vault.unlocked && state.vault.masterKey && !state.vault.masterKey.extractable")
                assert page.locator("#privacyVaultPassphrase").input_value() == ""
                assert page.locator("#privacyVaultConfirm").input_value() == ""

            def lock():
                page.locator("#avatarButton").click()
                page.locator("#lockVaultButton").click()
                expect(page.locator("#privacyVaultTitle")).to_have_text("Unlock your private vault")
                assert page.evaluate("state.vault.masterKey === null && state.projects.length === 0 && state.currentProject === null")
                assert PRIVATE_NAME not in page.locator("body").inner_text()
                assert page.evaluate("refs.detailGrid.innerHTML === '' && refs.projectForm.elements.name.value === '' && state.githubPickerProject === null")

            url = f"http://127.0.0.1:{server.server_port}/"
            page.goto(url)
            expect(page.locator("#privacyVaultTitle")).to_have_text("Create your private vault")
            expect(page.locator("#privacyVaultNotice")).to_have_text(
                "If you lose this passphrase, Stackroom cannot recover your encrypted project data.")
            submit("short")
            expect(page.locator("#privacyVaultError")).to_contain_text("at least 12")
            submit(confirm="different passphrase")
            expect(page.locator("#privacyVaultError")).to_contain_text("do not match")
            assert not writes
            backend["fail_create"] = True
            submit()
            expect(page.locator("#privacyVaultError")).to_contain_text("Unable to create")
            backend["fail_create"] = False
            submit()
            unlocked()
            print("PASS create validation, failed creation retry, non-extractable key")

            page.locator("#openCreateButton").click()
            page.locator("#projectForm [name=name]").fill(PRIVATE_NAME)
            page.locator("#projectForm [name=notes]").fill("Secret notes for regression")
            page.locator("#domainsFields [data-key=hostname]").fill("private.example")
            page.locator("#saveProjectButton").click()
            expect(page.locator("#detailHeader")).to_contain_text(PRIVATE_NAME)
            page.locator("#backToProjects").click()
            page.locator("#searchInput").fill("no match")
            expect(page.locator("#projectGrid")).not_to_contain_text(PRIVATE_NAME)
            page.locator("#searchInput").fill(PRIVATE_NAME)
            expect(page.locator("#projectGrid")).to_contain_text(PRIVATE_NAME)
            page.locator("#filterButton").click()
            page.locator('[data-filter="archived"]').click()
            expect(page.locator("#projectGrid")).not_to_contain_text(PRIVATE_NAME)
            page.locator("#filterButton").click()
            page.locator('[data-filter="all"]').click()
            page.locator('[data-nav="domains"]').click()
            expect(page.locator("#domainsTable")).to_contain_text("private.example")
            page.locator('[data-nav="attention"]').click()
            expect(page.locator("#attentionGrid")).to_contain_text(PRIVATE_NAME)
            page.locator('[data-nav="projects"]').click()
            page.locator('[data-action="open"]').first.click()
            page.locator("#detailGithubButton").click()
            page.locator('[data-repository-id="repo-1"]').click()
            expect(page.locator("#detailGrid")).to_contain_text("tester/repository")
            lock()
            # Errors must remain visible until the user edits or retries.
            submit("incorrect passphrase")
            expect(page.locator("#privacyVaultError")).to_have_text("Incorrect passphrase. Please try again.")
            page.wait_for_timeout(100)
            expect(page.locator("#privacyVaultError")).to_be_visible()
            page.locator("#privacyVaultPassphrase").fill("has/a/slash")
            page.locator("#privacyVaultPassphrase").press("/")
            assert page.locator("#privacyVaultPassphrase").input_value() == "has/a/slash/"
            assert page.evaluate("document.activeElement.id") == "privacyVaultPassphrase"
            page.locator("#privacyVaultPassphrase").press("Control+k")
            expect(page.locator("#commandBackdrop")).to_be_hidden()
            submit()
            unlocked()
            expect(page.locator("#projectGrid")).to_contain_text(PRIVATE_NAME)
            page.reload()
            expect(page.locator("#privacyVaultTitle")).to_have_text("Unlock your private vault")
            assert page.evaluate("state.vault.masterKey === null")
            submit()
            unlocked()
            expect(page.locator("#projectGrid")).to_contain_text(PRIVATE_NAME)
            print("PASS encrypted CRUD create, search, filters, domains, attention, GitHub link, lock/reload")

            # Delay crypto completion to verify locking cannot restore pending plaintext.
            page.evaluate("""() => {
                const decrypt = StackroomCrypto.decryptJSON;
                StackroomCrypto.decryptJSON = async (...args) => {
                    const result = await decrypt(...args);
                    await new Promise(resolve => window.finishDecrypt = resolve);
                    return result;
                };
                window.pendingLoad = loadProjects();
            }""")
            page.wait_for_function("typeof window.finishDecrypt === 'function'")
            lock()
            page.evaluate("async () => { finishDecrypt(); await pendingLoad; }")
            assert page.evaluate("state.projects.length === 0 && state.vault.masterKey === null")
            backend["fail_signout"] = True
            page.locator("#privacyVaultSignOut").click()
            expect(page.locator("#retrySignOutButton")).to_be_visible()
            assert page.evaluate("state.user === null && state.vault.record === null && state.githubRepositories.length === 0")
            backend["fail_signout"] = False
            page.locator("#retrySignOutButton").click()
            expect(page.locator("#retrySignOutButton")).to_be_hidden()
            expect(page.locator("#authSubmit")).to_be_enabled()
            print("PASS pending decrypt cancellation and failed sign-out cleanup/retry")

            backend["fail_get"] = True
            page.reload()
            expect(page.locator("#privacyVaultError")).to_contain_text("Unable to load")
            backend["fail_get"] = False
            page.locator("#privacyVaultSubmit").click()
            expect(page.locator("#privacyVaultTitle")).to_have_text("Unlock your private vault")
            submit()
            unlocked()
            expect(page.locator("#projectGrid")).to_contain_text(PRIVATE_NAME)
            page.locator('[data-action="open"]').first.click()
            page.locator("#detailEditButton").click()
            page.locator("#projectForm [name=notes]").fill("Changed secret notes")
            page.locator("#saveProjectButton").click()
            expect(page.locator("#detailGrid")).to_contain_text("Changed secret notes")
            page.on("dialog", lambda dialog: dialog.accept())
            page.evaluate("deleteProject('project-1')")
            expect(page.locator("#projectGrid")).not_to_contain_text(PRIVATE_NAME)
            print("PASS vault status retry and encrypted CRUD update/delete")

            # Simulate another tab winning the initial creation race.
            backend["vault"] = None
            backend["conflict"] = True
            page.reload()
            expect(page.locator("#privacyVaultTitle")).to_have_text("Create your private vault")
            submit()
            expect(page.locator("#privacyVaultTitle")).to_have_text("Unlock your private vault")
            expect(page.locator("#privacyVaultError")).to_contain_text("already exists")
            submit()
            unlocked()
            # A pending encryption must not send a project after locking.
            before_save = len(writes)
            page.evaluate("""() => {
                const encrypt = StackroomCrypto.encryptJSON;
                StackroomCrypto.encryptJSON = async (...args) => {
                    const result = await encrypt(...args);
                    await new Promise(resolve => window.finishEncrypt = resolve);
                    return result;
                };
            }""")
            page.locator("#openCreateButton").click()
            page.locator("#projectForm [name=name]").fill(PRIVATE_NAME)
            page.locator("#saveProjectButton").click()
            page.wait_for_function("typeof window.finishEncrypt === 'function'")
            page.evaluate("() => { void lockVault(); }")
            expect(page.locator("#privacyVaultTitle")).to_have_text("Unlock your private vault")
            page.evaluate("() => finishEncrypt()")
            page.wait_for_timeout(100)
            assert len(writes) == before_save
            assert page.evaluate("state.vault.masterKey === null && state.projects.length === 0")
            submit()
            unlocked()

            # Exercise the page lifecycle hooks used on a back/forward-cache restore.
            page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true}))")
            assert page.evaluate("state.vault.masterKey === null")
            page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}))")
            expect(page.locator("#privacyVaultTitle")).to_have_text("Unlock your private vault")
            page.evaluate("""() => {
                const unlock = StackroomCrypto.unlockVault;
                StackroomCrypto.unlockVault = async (...args) => {
                    const result = await unlock(...args);
                    await new Promise(resolve => window.finishUnlock = resolve);
                    return result;
                };
            }""")
            submit()
            page.wait_for_function("typeof window.finishUnlock === 'function'")
            page.locator("#privacyVaultSignOut").click()
            page.evaluate("() => finishUnlock()")
            page.wait_for_timeout(100)
            assert page.evaluate("state.user === null && state.vault.masterKey === null && !state.vault.unlocked")
            expect(page.locator("#privacyVaultBackdrop")).to_be_hidden()
            print("PASS lock during encryption, page restore, and sign-out during unlock")

            backend["vault"] = None
            backend["conflict"] = False
            page.reload()
            expect(page.locator("#privacyVaultTitle")).to_have_text("Create your private vault")
            page.set_viewport_size({"width": 375, "height": 667})
            assert page.locator("#privacyVaultSubmit").is_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.evaluate("""() => {
                const create = StackroomCrypto.createVault;
                StackroomCrypto.createVault = async (...args) => {
                    const result = await create(...args);
                    await new Promise(resolve => window.finishCreate = resolve);
                    return result;
                };
            }""")
            before_create = len([path for path, _ in writes if path == "/api/vault"])
            submit()
            page.wait_for_function("typeof window.finishCreate === 'function'")
            page.locator("#privacyVaultSignOut").click()
            page.evaluate("() => finishCreate()")
            page.wait_for_timeout(100)
            assert before_create == len([path for path, _ in writes if path == "/api/vault"])
            assert page.evaluate("state.user === null && state.vault.masterKey === null")
            print("PASS mobile vault layout and sign-out during creation")
            assert page.evaluate("window.persistenceWrites.length === 0")
            assert not context.cookies()
            for path, data in writes:
                encoded = json.dumps(data)
                assert PASSPHRASE not in encoded and PRIVATE_NAME not in encoded
                assert "Secret notes" not in encoded and "Changed secret notes" not in encoded
                if path == "/api/vault":
                    assert set(data) == {"encrypted_master_key", "salt", "wrap_iv", "kdf", "kdf_iterations", "crypto_version"}
                if path.startswith("/api/projects") and not path.endswith("/github"):
                    assert set(data) == {"encryptedPayload", "encryptionVersion", "isEncrypted"}
            assert not errors, errors
            print("PASS create conflict, ciphertext-only requests, no browser persistence or JS errors")
            run_migration_checks(browser, url, PASSPHRASE)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    run()
